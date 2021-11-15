// Import plugins
const cors = require("fastify-cors");

const { registerGetSchema } = require("./schema");
const { registerSelect } = require("./query");

/**
 * @author Frazer Smith
 * @description Sets routing options for server.
 * @param {Function} server - Fastify instance.
 * @param {object} options - Route config values.
 * @param {*=} options.bearerTokenAuthKeys - Apply `bearerToken` security scheme to route if defined.
 * @param {object} options.cors - CORS settings.
 * @param {object} options.database - Database config values.
 * @param {object} options.database.tables - Database tables.
 * @param {string} options.database.tables.documentRegister - Name and schema of document register table.
 */
async function route(server, options) {
	if (options.bearerTokenAuthKeys) {
		registerGetSchema.security = [{ bearerToken: [] }];
	}

	// Register plugins
	server
		// Use CORS: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
		.register(cors, {
			...options.cors,
			methods: ["GET"],
		});

	server.route({
		method: "GET",
		url: "/",
		schema: registerGetSchema,
		async handler(req, res) {
			try {
				const page = parseInt(req.query.page, 10) - 1;
				const perPage = parseInt(req.query.perPage, 10);

				// Build WHERE clause using lastModified querystring params
				const whereArray = [];

				let lastModified = [];
				if (Array.isArray(req.query.lastModified)) {
					lastModified = req.query.lastModified;
				} else {
					lastModified.push(req.query.lastModified);
				}

				lastModified.forEach((modified) => {
					let date = modified;
					const operator = server.convertDateParamOperator(
						escape(date).substring(0, 2)
					);

					if (Number.isNaN(Number(date.substring(0, 2)))) {
						date = date.substring(2, date.length);
					}

					whereArray.push(`(Modified ${operator} '${date}')`);
				});

				const whereClausePredicates = whereArray.join(" AND ");

				const results = await server.db.query(
					registerSelect({
						whereClausePredicates,
						documentRegisterTable:
							options.database.tables.documentRegister,
						page,
						perPage,
					})
				);

				/**
				 * Database client packages return results in different structures,
				 * (mssql uses recordsets, pgsql uses rows) thus the optional chaining
				 */
				const count =
					results?.recordsets?.[0]?.[0]?.total ??
					results?.[0]?.rows?.[0]?.total ??
					0;
				const data = server.cleanObject(
					results?.recordsets?.[1] ?? results?.[1]?.rows ?? []
				);

				const response = {
					data,
					meta: {
						pagination: {
							total: count,
							per_page: perPage,
							current_page: page + 1,
							total_pages: Math.ceil(count / perPage),
						},
					},
				};
				res.send(response);
			} catch (err) {
				req.log.error({ req, res, err }, err && err.message);
				throw res.internalServerError(
					"Unable to return result(s) from database"
				);
			}
		},
	});
}

module.exports = route;
