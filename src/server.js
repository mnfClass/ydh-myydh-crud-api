const autoLoad = require("@fastify/autoload");
const fp = require("fastify-plugin");
const path = require("upath");
const secJSON = require("secure-json-parse");

// Import plugins
const accepts = require("@fastify/accepts");
const basic = require("@fastify/basic-auth");
const compress = require("@fastify/compress");
const disableCache = require("fastify-disablecache");
const flocOff = require("fastify-floc-off");
const helmet = require("@fastify/helmet");
const rateLimit = require("@fastify/rate-limit");
const sensible = require("@fastify/sensible");
const staticPlugin = require("@fastify/static");
const swagger = require("@fastify/swagger");
const underPressure = require("@fastify/under-pressure");
const clean = require("./plugins/clean-object");
const convertDateParamOperator = require("./plugins/convert-date-param-operator");
const db = require("./plugins/db");
const hashedBearerAuth = require("./plugins/hashed-bearer-auth");
const serializeJsonToXml = require("./plugins/serialize-json-to-xml");
const sharedSchemas = require("./plugins/shared-schemas");

/**
 * @author Frazer Smith
 * @description Build Fastify instance.
 * @param {object} server - Fastify instance.
 * @param {object} config - Fastify configuration values.
 */
async function plugin(server, config) {
	// Register plugins
	await server
		// Accept header handler
		.register(accepts)

		// Support Content-Encoding
		.register(compress, { inflateIfDeflated: true })

		// Database connection
		.register(db, config.database)

		// Set response headers to disable client-side caching
		.register(disableCache)

		// Opt-out of Google's FLoC advertising-surveillance network
		.register(flocOff)

		// Use Helmet to set response security headers: https://helmetjs.github.io/
		.register(helmet, config.helmet)

		// Utility functions and error handlers
		.register(sensible)

		// Serialization support for XML responses
		.register(serializeJsonToXml)

		// Reusable schemas
		.register(sharedSchemas)

		// Generate OpenAPI/Swagger schemas
		.register(swagger, config.swagger)

		// Process load and 503 response handling
		.register(underPressure, config.processLoad)

		// Additional utility functions
		.register(clean)
		.register(convertDateParamOperator)

		// Rate limiting and 429 response handling
		.register(rateLimit, config.rateLimit);

	// Register routes
	await server
		/**
		 * `x-xss-protection` and `content-security-policy` is set by default by Helmet.
		 * These are only useful for HTML/XML content; the only CSP directive that
		 * is of use to other content is "frame-ancestors 'none'" to stop responses
		 * from being wrapped in iframes and used for clickjacking attacks.
		 */
		.addHook("onSend", async (req, res, payload) => {
			if (
				!res.getHeader("content-type")?.includes("html") &&
				!res.getHeader("content-type")?.includes("xml")
			) {
				res.header(
					"content-security-policy",
					"default-src 'self';frame-ancestors 'none'"
				);
				res.raw.removeHeader("x-xss-protection");
			}
			return payload;
		})

		// Import and register healthcheck route
		.register(autoLoad, {
			dir: path.joinSafe(__dirname, "routes", "admin", "healthcheck"),
			options: { ...config, prefix: "admin/healthcheck" },
		})

		/**
		 * Encapsulate plugins and routes into child context, so that other
		 * routes do not inherit `accepts` preHandler.
		 * See https://www.fastify.io/docs/latest/Encapsulation/ for more info
		 */
		.register(async (serializedContext) => {
			serializedContext
				// Catch unsupported Accept header media types
				.addHook("onRequest", async (req) => {
					if (
						!req
							.accepts()
							.type(["application/json", "application/xml"])
					) {
						throw server.httpErrors.notAcceptable();
					}
				});

			await serializedContext
				/**
				 * Encapsulate plugins and routes into secured child context, so that other
				 * routes do not inherit bearer token auth plugin (if enabled).
				 */
				.register(async (securedContext) => {
					// Protect routes with Bearer token auth if enabled
					if (config.bearerTokenAuthEnabled) {
						await securedContext.register(hashedBearerAuth);
					}
					await securedContext
						// Import and register service routes
						.register(autoLoad, {
							dir: path.joinSafe(__dirname, "routes"),
							ignorePattern: /(admin|docs)/,
							options: config,
						});
				})

				/**
				 * Encapsulate the admin/access routes into a child context, so that the other
				 * routes do not inherit basic auth plugin.
				 */
				.register(async (adminContext) => {
					await adminContext
						// Protect routes with Basic auth
						.register(basic, {
							validate: async (username, password) => {
								if (
									username !== config.admin.username ||
									password !== config.admin.password
								) {
									throw server.httpErrors.unauthorized();
								}
							},
							authenticate: false,
						});

					adminContext.addHook("onRequest", adminContext.basicAuth);

					await adminContext
						// Import and register service routes
						.register(autoLoad, {
							dir: path.joinSafe(__dirname, "routes", "admin"),
							ignorePattern: /(healthcheck)/,
							options: { ...config, prefix: "admin" },
						});
				});
		})

		/**
		 * Encapsulate the docs routes into a child context, so that the
		 * CSP can be relaxed, and cache enabled, without impacting
		 * security of other routes
		 */
		.register(async (publicContext) => {
			const relaxedHelmetConfig = secJSON.parse(
				JSON.stringify(config.helmet)
			);
			Object.assign(
				relaxedHelmetConfig.contentSecurityPolicy.directives,
				{
					"script-src": ["'self'", "'unsafe-inline'"],
					"style-src": ["'self'", "'unsafe-inline'"],
					"child-src": ["'self'", "blob:"],
				}
			);

			await publicContext
				// Set relaxed response headers
				.register(helmet, relaxedHelmetConfig)

				// Register static files in ./src/public
				.register(staticPlugin, {
					root: path.joinSafe(__dirname, "public"),
					immutable: true,
					maxAge: "365 days",
				})
				.register(autoLoad, {
					dir: path.joinSafe(__dirname, "routes", "docs"),
					options: { ...config, prefix: "docs" },
				});
		})

		// Rate limit 404 responses
		.setNotFoundHandler(
			{
				preHandler: server.rateLimit(),
			},
			async (req, res) =>
				res.notFound(`Route ${req.method}:${req.url} not found`)
		)

		// Errors thrown by routes and plugins are caught here
		.setErrorHandler(async (err, req, res) => {
			if (
				(err.statusCode >= 500 &&
					/* istanbul ignore next: under-pressure plugin throws valid 503s */
					err.statusCode !== 503) ||
				/**
				 * Uncaught errors will have a res.statusCode but not
				 * an err.statusCode as @fastify/sensible sets that
				 */
				(res.statusCode === 200 && !err.statusCode)
			) {
				res.log.error(err);
				return res.internalServerError();
			}

			throw err;
		});
}

module.exports = fp(plugin, { fastify: "4.x", name: "server" });
