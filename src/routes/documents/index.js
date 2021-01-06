const createError = require("http-errors");
const sqlServer = require("mssql");

const clean = require("../../utils/clean-objects");
const convertDateParamOperator = require("../../utils/convert-date-param-operation");

const {
	registerGetSchema,
	receiptPutSchema,
	receiptDeleteSchema,
} = require("./schema");

/**
 * @author Frazer Smith
 * @description Sets routing options for server.
 * @param {Function} server - Fastify instance.
 * @param {object} options - Object containing route config objects.
 */
async function route(server, options) {
	server.route({
		method: "GET",
		url: "/register",
		schema: registerGetSchema,
		async handler(req, res) {
			try {
				const page = parseInt(req.query.page, 10) - 1 || 0;
				const perPage = parseInt(req.query.perPage, 10) || 1;

				// Build WHERE clause using lastModified querystring param
				const operator = convertDateParamOperator(
					escape(req.query.lastModified).substring(0, 2)
				);
				// eslint-disable-next-line no-restricted-globals
				if (isNaN(req.query.lastModified.substring(0, 2))) {
					req.query.lastModified = req.query.lastModified.substring(
						2,
						req.query.lastModified.length
					);
				}

				// Create meta object with pagination data
				const count = await server.mssql
					.request()
					.input(
						"timestamp",
						sqlServer.DateTime,
						req.query.lastModified
					).query(`SELECT COUNT(*) AS total
							  FROM ${options.database.tables.documentRegister}
							 WHERE Modified ${operator} @timestamp`);

				const result = {
					data: [],
					meta: {
						pagination: {
							total: count.recordset[0].total,
							per_page: perPage,
							current_page: page + 1,
							total_pages: Math.ceil(
								count.recordset[0].total / perPage
							),
						},
					},
				};

				const queryResult = await server.mssql
					.request()
					.input(
						"timestamp",
						sqlServer.DateTime,
						req.query.lastModified
					)
					.query(
						`SELECT *
						   FROM ${options.database.tables.documentRegister}
						   WHERE Modified ${operator} @timestamp
						   ORDER BY Modified DESC
						   OFFSET ${page * perPage} ROWS
						   FETCH NEXT ${perPage} ROWS ONLY`
					);

				if (queryResult.recordset) {
					result.data = clean(queryResult.recordset);
					res.send(result);
				} else {
					res.send(
						createError(404, "Invalid or expired search results")
					);
				}
			} catch (err) {
				server.log.error(err);
				res.send(
					createError(500, "Unable to return result(s) from database")
				);
			}
		},
	});

	server.route({
		method: "PUT",
		url: "/receipt/:id",
		schema: receiptPutSchema,
		async handler(req, res) {
			res.send("hi");
		},
	});

	server.route({
		method: "DELETE",
		url: "/receipt/:id",
		schema: receiptDeleteSchema,
		async handler(req, res) {
			res.send("hi");
		},
	});
}

module.exports = route;
