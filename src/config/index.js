require("dotenv").config();

const envSchema = require("env-schema");
const S = require("fluent-json-schema");
const fs = require("fs/promises");
const path = require("upath");
const pino = require("pino");
const rotatingLogStream = require("file-stream-rotator");
const secJSON = require("secure-json-parse");

const { license, version } = require("../../package.json");

/**
 * @author Frazer Smith
 * @description Convert string boolean to boolean
 * or comma-delimited string to array.
 * @param {string} param - CORS parameter.
 * @returns {boolean|Array|string} CORS parameter.
 */
function parseCorsParameter(param) {
	if (param.trim() === "true") {
		return true;
	}
	if (param.trim() === "false") {
		return false;
	}
	if (param.includes(",")) {
		return param
			.trim()
			.split(",")
			.map((value) => value.trim());
	}
	return param;
}

/**
 * @author Frazer Smith
 * @description Validate environment variables and build server config.
 * @returns {object} Server config.
 */
async function getConfig() {
	// Validate env variables
	const env = envSchema({
		dotenv: true,
		schema: S.object()
			.additionalProperties(false)
			.prop("NODE_ENV", S.string())

			// Service
			.prop("HOST", S.string())
			.prop("PORT", S.number())

			// CORS
			.prop("CORS_ORIGIN", S.anyOf([S.string(), S.null()]))
			.prop("CORS_ALLOWED_HEADERS", S.anyOf([S.string(), S.null()]))
			.prop("CORS_ALLOW_CREDENTIALS", S.anyOf([S.boolean(), S.null()]))
			.prop("CORS_EXPOSED_HEADERS", S.anyOf([S.string(), S.null()]))
			.prop("CORS_MAX_AGE", S.anyOf([S.number(), S.null()]))

			// HTTPS
			.prop("HTTPS_PFX_PASSPHRASE", S.anyOf([S.string(), S.null()]))
			.prop("HTTPS_PFX_FILE_PATH", S.anyOf([S.string(), S.null()]))
			.prop("HTTPS_SSL_CERT_PATH", S.anyOf([S.string(), S.null()]))
			.prop("HTTPS_SSL_KEY_PATH", S.anyOf([S.string(), S.null()]))
			.prop("HTTPS_HTTP2_ENABLED", S.anyOf([S.boolean(), S.null()]))

			// Logger
			.prop(
				"LOG_LEVEL",
				S.anyOf([
					S.string().enum([
						"fatal",
						"error",
						"warn",
						"info",
						"debug",
						"trace",
						"silent",
					]),
					S.null(),
				])
			)
			.prop("LOG_ROTATION_DATE_FORMAT", S.anyOf([S.string(), S.null()]))
			.prop("LOG_ROTATION_FILENAME", S.anyOf([S.string(), S.null()]))
			.prop(
				"LOG_ROTATION_FREQUENCY",
				S.anyOf([
					S.string().enum(["custom", "daily", "test"]),
					S.null(),
				])
			)
			.prop("LOG_ROTATION_MAX_LOGS", S.anyOf([S.string(), S.null()]))
			.prop("LOG_ROTATION_MAX_SIZE", S.anyOf([S.string(), S.null()]))

			// Process Load Handling
			.prop(
				"PROC_LOAD_MAX_EVENT_LOOP_DELAY",
				S.anyOf([S.number(), S.null()])
			)
			.prop(
				"PROC_LOAD_MAX_EVENT_LOOP_UTILIZATION",
				S.anyOf([S.number(), S.null()])
			)
			.prop(
				"PROC_LOAD_MAX_HEAP_USED_BYTES",
				S.anyOf([S.number(), S.null()])
			)
			.prop("PROC_LOAD_MAX_RSS_BYTES", S.anyOf([S.number(), S.null()]))

			// Rate Limiting
			.prop("RATE_LIMIT_EXCLUDED_ARRAY", S.anyOf([S.string(), S.null()]))
			.prop(
				"RATE_LIMIT_MAX_CONNECTIONS_PER_MIN",
				S.anyOf([S.number(), S.null()])
			)

			// Admin login
			.prop("ADMIN_USERNAME", S.string())
			.prop("ADMIN_PASSWORD", S.string().minLength(8))

			// Bearer token auth
			.prop("BEARER_TOKEN_AUTH_ENABLED", S.anyOf([S.boolean(), S.null()]))

			// Database Connection
			.prop(
				"DB_CLIENT",
				S.anyOf([S.string().enum(["mssql", "postgresql"]), S.null()])
			)
			.prop("DB_CONNECTION_STRING", S.string())
			.prop("DB_DOCUMENT_REGISTER_TABLE", S.string())
			.prop("DB_PATIENT_PREFERENCES_TABLE", S.string())
			.prop("DB_PATIENT_PREFERENCES_TYPE_TABLE", S.string())
			.prop("DB_PATIENT_PREFERENCES_VALUE_TABLE", S.string())
			.prop("DB_READ_RECEIPT_DOCS_TABLE", S.string())
			.required([
				"NODE_ENV",
				"HOST",
				"PORT",
				"DB_CONNECTION_STRING",
				"DB_DOCUMENT_REGISTER_TABLE",
				"DB_PATIENT_PREFERENCES_TABLE",
				"DB_PATIENT_PREFERENCES_TYPE_TABLE",
				"DB_PATIENT_PREFERENCES_VALUE_TABLE",
				"DB_READ_RECEIPT_DOCS_TABLE",
			]),
	});

	const config = {
		fastify: {
			port: env.PORT,
		},
		fastifyInit: {
			/**
			 * See https://www.fastify.io/docs/v3.8.x/Logging/
			 * and https://getpino.io/#/docs/api for logger options
			 */
			logger: {
				formatters: {
					level(label) {
						return { level: label };
					},
				},
				level: env.LOG_LEVEL || "info",
				redact: ["req.headers.authorization"],
				serializers: {
					/* istanbul ignore next: pino functions not explicitly tested */
					req(req) {
						return pino.stdSerializers.req(req);
					},
					/* istanbul ignore next: pino functions not explicitly tested */
					res(res) {
						// Required for the statusCode to be logged
						// https://github.com/pinojs/pino-std-serializers/blob/9da36144d43aabc7933f0504b02fef5a341583c2/lib/res.js#L37
						res.headersSent = true;
						return pino.stdSerializers.res(res);
					},
				},
				timestamp: () => pino.stdTimeFunctions.isoTime(),
			},
			ignoreTrailingSlash: true,
		},
		cors: {
			origin: parseCorsParameter(env.CORS_ORIGIN) || false,
			hideOptionsRoute: true,
		},
		helmet: {
			contentSecurityPolicy: {
				directives: {
					"default-src": ["'self'"],
					"base-uri": ["'self'"],
					"img-src": ["'self'", "data:"],
					"object-src": ["'none'"],
					"child-src": ["'self'"],
					"frame-ancestors": ["'none'"],
					"form-action": ["'self'"],
					"upgrade-insecure-requests": [],
					"block-all-mixed-content": [],
					"script-src": null,
					"script-src-attr": null,
					"style-src": null,
					"font-src": null,
				},
			},
			crossOriginEmbedderPolicy: false,
			crossOriginOpenerPolicy: false,
			crossOriginResourcePolicy: false,
			hsts: {
				maxAge: 31536000,
			},
			// Only supported by Chrome at time of writing
			originAgentCluster: false,
		},
		processLoad: {
			maxEventLoopDelay: env.PROC_LOAD_MAX_EVENT_LOOP_DELAY || 0,
			maxEventLoopUtilization:
				env.PROC_LOAD_MAX_EVENT_LOOP_UTILIZATION || 0,
			maxHeapUsedBytes: env.PROC_LOAD_MAX_HEAP_USED_BYTES || 0,
			maxRssBytes: env.PROC_LOAD_MAX_RSS_BYTES || 0,
		},
		rateLimit: {
			continueExceeding: true,
			hook: "onSend",
			max: env.RATE_LIMIT_MAX_CONNECTIONS_PER_MIN || 1000,
			timeWindow: 60000,
		},
		swagger: {
			openapi: {
				info: {
					title: "YDH MyYDH CRUD API",
					description:
						'<a href="https://yeovilhospital.co.uk/">Yeovil District Hospital NHSFT</a>\'s MyYDH RESTful API, a Node.js application using the <a href="https://www.fastify.io/">Fastify web framework</a>, built to support CRUD (Create, Read, Update, and Delete) functionality of patient contact preferences for the MyYDH patient and clinician app at https://my.ydh.nhs.uk.',
					contact: {
						name: "Solutions Development Team",
						email: "servicedesk@ydh.nhs.uk",
					},
					license: {
						name: license,
						url: "https://raw.githubusercontent.com/Fdawgs/ydh-myydh-crud-api/master/LICENSE",
					},
					version,
					// Redoc specific extension to support loading image in docs
					"x-logo": {
						url: "/images/ydh-y-logo-transparent-background-wide-canvas.png",
						backgroundColor: "#6D3176",
						altText:
							"Yeovil District Hospital NHS Foundation Trust Logo",
					},
				},
				components: {
					securitySchemes: {
						basicAuth: {
							type: "http",
							description:
								"Expects the request to contain an `Authorization` header with basic auth credentials.",
							scheme: "basic",
						},
					},
				},
				tags: [
					{
						name: "Contact Preferences",
						description:
							"Endpoints relating to patient contact preferences",
					},
					{
						name: "Documents",
						description:
							"Endpoints relating to patient clinical documents",
					},
					{
						name: "System Administration",
						description: "",
					},
				],
			},
		},
		admin: {
			username: env.ADMIN_USERNAME,
			password: env.ADMIN_PASSWORD,
		},
		bearerTokenAuthEnabled: env.BEARER_TOKEN_AUTH_ENABLED === true,
		database: {
			client: env.DB_CLIENT || "mssql",
			connection: env.DB_CONNECTION_STRING,
			tables: {
				documentRegister: env.DB_DOCUMENT_REGISTER_TABLE,
				patientPref: env.DB_PATIENT_PREFERENCES_TABLE,
				patientPrefTypeLookup: env.DB_PATIENT_PREFERENCES_TYPE_TABLE,
				patientPrefValueLookup: env.DB_PATIENT_PREFERENCES_VALUE_TABLE,
				readReceipt: env.DB_READ_RECEIPT_DOCS_TABLE,
			},
		},
	};

	// Ensure API listens on both IPv4 and IPv6 addresses
	if (env.HOST) {
		config.fastify.host = env.HOST;
	}

	if (env.LOG_ROTATION_FILENAME) {
		// Rotation options: https://github.com/rogerc/file-stream-rotator/#options
		config.fastifyInit.logger.stream = rotatingLogStream.getStream({
			date_format: env.LOG_ROTATION_DATE_FORMAT || "YYYY-MM-DD",
			filename: path.normalizeTrim(env.LOG_ROTATION_FILENAME),
			frequency: env.LOG_ROTATION_FREQUENCY || "daily",
			max_logs: env.LOG_ROTATION_MAX_LOGS,
			size: env.LOG_ROTATION_MAX_SIZE,
			verbose: false,
		});
	}

	if (env.RATE_LIMIT_EXCLUDED_ARRAY) {
		config.rateLimit.allowList = secJSON.parse(
			env.RATE_LIMIT_EXCLUDED_ARRAY
		);
	}

	if (env.BEARER_TOKEN_AUTH_ENABLED === true) {
		config.swagger.openapi.components.securitySchemes.bearerToken = {
			type: "http",
			description:
				"Expects the request to contain an `Authorization` header with a bearer token.",
			scheme: "bearer",
			bearerFormat: "Bearer <token>",
		};
	}

	if (env.CORS_ALLOW_CREDENTIALS === true) {
		config.cors.credentials = true;
	}
	if (env.CORS_ALLOWED_HEADERS) {
		config.cors.allowedHeaders = env.CORS_ALLOWED_HEADERS;
	}
	if (env.CORS_EXPOSED_HEADERS) {
		config.cors.exposedHeaders = env.CORS_EXPOSED_HEADERS;
	}
	if (env.CORS_MAX_AGE) {
		config.cors.maxAge = env.CORS_MAX_AGE;
	}

	// Enable HTTPS using cert/key or passphrase/pfx combinations
	if (env.HTTPS_SSL_CERT_PATH && env.HTTPS_SSL_KEY_PATH) {
		try {
			config.fastifyInit.https = {
				// eslint-disable-next-line security/detect-non-literal-fs-filename
				cert: await fs.readFile(
					path.normalizeTrim(env.HTTPS_SSL_CERT_PATH)
				),
				// eslint-disable-next-line security/detect-non-literal-fs-filename
				key: await fs.readFile(
					path.normalizeTrim(env.HTTPS_SSL_KEY_PATH)
				),
			};
		} catch (err) {
			throw new Error(
				`No such file or directory ${err.path} for SSL cert/key, falling back to HTTP`
			);
		}
	}

	if (env.HTTPS_PFX_PASSPHRASE && env.HTTPS_PFX_FILE_PATH) {
		try {
			config.fastifyInit.https = {
				passphrase: env.HTTPS_PFX_PASSPHRASE,
				// eslint-disable-next-line security/detect-non-literal-fs-filename
				pfx: await fs.readFile(
					path.normalizeTrim(env.HTTPS_PFX_FILE_PATH)
				),
			};
		} catch (err) {
			throw new Error(
				`No such file or directory ${err.path} for PFX file, falling back to HTTP`
			);
		}
	}

	if (config.fastifyInit.https && env.HTTPS_HTTP2_ENABLED === true) {
		config.fastifyInit.https.allowHTTP1 = true;
		config.fastifyInit.http2 = true;
	}

	return config;
}

module.exports = getConfig;
