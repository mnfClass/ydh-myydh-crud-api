const Fastify = require("fastify");
const accepts = require("@fastify/accepts");
const plugin = require(".");

describe("Serialize-JSON-To-XML Plugin", () => {
	let server;

	beforeAll(async () => {
		server = Fastify();

		await server.register(accepts).register(plugin);
		server.route({
			method: "GET",
			url: "/",
			handler: (req, res) => {
				res.send({ "test-key": "test-value" });
			},
		});

		await server.ready();
	});

	afterAll(async () => {
		await server.close();
	});

	test("Should return JSON string", async () => {
		const response = await server.inject({
			method: "GET",
			url: "/",
		});

		expect(JSON.parse(response.payload)["test-key"]).toBe("test-value");
		expect(response.headers["content-type"]).toBe(
			"application/json; charset=utf-8"
		);
		expect(response.statusCode).toBe(200);
	});

	test("Should return XML string", async () => {
		const response = await server.inject({
			method: "GET",
			url: "/",
			headers: {
				accept: "application/xml",
			},
		});

		expect(response.payload).toBe(
			'<?xml version="1.0" encoding="UTF-8"?><response><test-key>test-value</test-key></response>'
		);
		expect(response.headers["content-type"]).toBe(
			"application/xml; charset=utf-8"
		);
		expect(response.statusCode).toBe(200);
	});
});
