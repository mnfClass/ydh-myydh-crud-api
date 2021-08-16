const faker = require("faker");
const Fastify = require("fastify");
const plugin = require(".");
const getConfig = require("../../config");

// TODO: look at standing up test SQL Server instance with Docker and disable skip for this
describe.skip("db plugin", () => {
	let config;
	let server;

	const query = "SELECT CURRENT_TIMESTAMP";
	const client = {
		query: jest.fn().mockResolvedValue({}),
	};

	beforeAll(async () => {
		config = await getConfig();

		server = Fastify();
		server.register(plugin, config);
		server.route({
			method: "GET",
			url: "/",
			handler: async () => {
				const fakeClient = await server.db.connect();
				return fakeClient.query(query);
			},
		});

		await server.ready();
		server.db.connect = jest.fn();
	});

	afterAll(async () => {
		await server.close();
	});

	test("Should instrument request with db plugin", async () => {
		const result = faker.lorem.word();

		client.query.mockResolvedValue(result);
		server.db.connect.mockResolvedValue(client);

		const response = await server.inject({
			method: "GET",
			url: "/",
		});

		expect(response.statusCode).toEqual(200);
		expect(response.payload).toEqual(result);
		expect(client.query).toHaveBeenNthCalledWith(1, query);
	});
});
