const Fastify = require("fastify");
const startServer = require("./server");
const getConfig = require("./config");

const expResHeaders = {
	"cache-control": "no-store, max-age=0, must-revalidate",
	connection: "keep-alive",
	"content-length": expect.anything(),
	"content-security-policy": "default-src 'self';frame-ancestors 'none'",
	"content-type": expect.stringContaining("text/plain"),
	date: expect.any(String),
	"expect-ct": "max-age=0",
	expires: "0",
	"permissions-policy": "interest-cohort=()",
	pragma: "no-cache",
	"referrer-policy": "no-referrer",
	"strict-transport-security": "max-age=31536000; includeSubDomains",
	"surrogate-control": "no-store",
	vary: "Origin, accept-encoding",
	"x-content-type-options": "nosniff",
	"x-dns-prefetch-control": "off",
	"x-download-options": "noopen",
	"x-frame-options": "SAMEORIGIN",
	"x-permitted-cross-domain-policies": "none",
	"x-ratelimit-limit": expect.any(Number),
	"x-ratelimit-remaining": expect.any(Number),
	"x-ratelimit-reset": expect.any(Number),
};

const expResHeadersJson = {
	...expResHeaders,
	"content-type": expect.stringContaining("application/json"),
};

describe("Server Deployment", () => {
	const connectionTests = [
		{
			testName: "MSSQL Connection",
			envVariables: {
				DB_CLIENT: "mssql",
				DB_CONNECTION_STRING:
					"Server=localhost,1433;Database=master;User Id=sa;Password=Password!;Encrypt=true;TrustServerCertificate=true;",
			},
		},
		{
			testName: "PostgreSQL Connection",
			envVariables: {
				DB_CLIENT: "postgresql",
				DB_CONNECTION_STRING:
					"postgresql://postgres:password@localhost:5432/myydh_crud_api",
			},
		},
	];
	connectionTests.forEach((testObject) => {
		describe(`${testObject.testName}`, () => {
			beforeAll(async () => {
				Object.assign(process.env, testObject.envVariables);
			});

			describe("End-To-End - Bearer Token Disabled", () => {
				let config;
				let server;

				beforeAll(async () => {
					Object.assign(process.env, {
						AUTH_BEARER_TOKEN_ARRAY: "",
					});
					config = await getConfig();

					server = Fastify();
					server.register(startServer, config);

					await server.ready();
				});

				afterAll(async () => {
					await server.close();
				});

				describe("/admin/healthcheck Route", () => {
					test("Should return `ok`", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/admin/healthcheck",
							headers: {
								accept: "text/plain",
							},
						});

						expect(response.payload).toBe("ok");
						expect(response.headers).toEqual(expResHeaders);
						expect(response.statusCode).toBe(200);
					});

					test("Should return HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/admin/healthcheck",
							headers: {
								accept: "application/javascript",
							},
						});

						expect(JSON.parse(response.payload)).toEqual({
							error: "Not Acceptable",
							message: "Not Acceptable",
							statusCode: 406,
						});
						expect(response.headers).toEqual(expResHeadersJson);
						expect(response.statusCode).toBe(406);
					});
				});
			});

			describe("End-To-End - Bearer Token Enabled", () => {
				let config;
				let server;

				beforeAll(async () => {
					Object.assign(process.env, {
						AUTH_BEARER_TOKEN_ARRAY:
							'[{"service": "test", "value": "testtoken"}]',
					});
					config = await getConfig();

					server = Fastify();
					server.register(startServer, config);

					await server.ready();
				});

				afterAll(async () => {
					await server.close();
				});

				describe("/admin/healthcheck Route", () => {
					test("Should return `ok`", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/admin/healthcheck",
							headers: {
								accept: "text/plain",
							},
						});

						expect(response.payload).toBe("ok");
						expect(response.headers).toEqual(expResHeaders);
						expect(response.statusCode).toBe(200);
					});

					test("Should return HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/admin/healthcheck",
							headers: {
								accept: "application/javascript",
							},
						});

						expect(JSON.parse(response.payload)).toEqual({
							error: "Not Acceptable",
							message: "Not Acceptable",
							statusCode: 406,
						});
						expect(response.headers).toEqual(expResHeadersJson);
						expect(response.statusCode).toBe(406);
					});
				});

				describe("/preferences/options Route", () => {
					test("Should return HTTP status code 401 if bearer token invalid", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/preferences/options",
							headers: {
								accept: "application/json",
								authorization: "Bearer invalid",
							},
						});

						expect(response.headers).toEqual({
							...expResHeadersJson,
							vary: "accept-encoding",
						});
						expect(response.statusCode).toBe(401);
					});

					test("Should return HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/preferences/options",
							headers: {
								accept: "application/javascript",
								authorization: "Bearer testtoken",
							},
						});

						expect(JSON.parse(response.payload)).toEqual({
							error: "Not Acceptable",
							message: "Not Acceptable",
							statusCode: 406,
						});
						expect(response.headers).toEqual(expResHeadersJson);
						expect(response.statusCode).toBe(406);
					});

					test("Should return response if media type in `Accept` request header is supported", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/preferences/options",
							headers: {
								accept: "application/json",
								authorization: "Bearer testtoken",
							},
						});

						expect(response.headers).toEqual(expResHeadersJson);
						expect(response.statusCode).not.toBe(406);
					});
				});
			});
		});
	});
});
