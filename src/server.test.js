const faker = require("faker/locale/en_GB");
const Fastify = require("fastify");
const startServer = require("./server");
const getConfig = require("./config");

const mockPage = faker.random.number({
	min: 1,
	max: 10,
});

const mockLastModified = faker.date.past().toISOString().split("T")[0];

describe("Server deployment", () => {
	let config;
	let server;

	beforeAll(async () => {
		config = await getConfig();

		server = Fastify();
		server.register(startServer, config);

		await server.ready();
	});

	beforeEach(() => {
		jest.resetAllMocks();
	});

	afterAll(() => {
		server.close();
	});

	afterAll(async () => {
		await server.close();
	});

	test("Should return documents from register", async () => {
		server.mssql = {
			query: jest.fn(),
		};

		const response = await server.inject({
			method: "GET",
			url: "/documents/register",
			headers: {
				authorization: "Bearer testtoken",
			},
			query: {
				lastModified: mockLastModified,
				perPage: mockPage,
				page: mockPage,
			},
		});

		expect(JSON.parse(response.payload)).toEqual({
			data: [],
			meta: {
				pagination: {
					total: 0,
					per_page: mockPage,
					current_page: mockPage,
					total_pages: 0,
				},
			},
		});
		expect(response.statusCode).toEqual(200);
	});
});
