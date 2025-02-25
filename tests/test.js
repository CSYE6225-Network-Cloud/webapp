const request = require('supertest');
const app = require('../server');
const db = require('../db');

// Ensure database is initialized before running tests
beforeAll(async () => {
    await db.sequelize.sync(); // Creates tables if they don't exist
});

afterAll(async () => {
    await db.sequelize.close(); // Close DB connection after all tests
});

describe('Health Check API (/healthz)', () => {
    test('GET /healthz should return 200 OK with no body and valid headers', async () => {
        const response = await request(app).get('/healthz');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({});
    });

    test('HEAD /healthz should return 405 Method Not Allowed', async () => {
        const response = await request(app).head('/healthz');
        expect(response.status).toBe(405);
    });

    test('POST /healthz should return 405 Method Not Allowed', async () => {
        const response = await request(app).post('/healthz');
        expect(response.status).toBe(405);
    });

    test('PUT /healthz should return 405 Method Not Allowed', async () => {
        const response = await request(app).put('/healthz');
        expect(response.status).toBe(405);
    });

    test('PATCH /healthz should return 405 Method Not Allowed', async () => {
        const response = await request(app).patch('/healthz');
        expect(response.status).toBe(405);
    });

    test('DELETE /healthz should return 405 Method Not Allowed', async () => {
        const response = await request(app).delete('/healthz');
        expect(response.status).toBe(405);
    });

    test('OPTIONS /healthz should return 405 Method Not Allowed', async () => {
        const response = await request(app).options('/healthz');
        expect(response.status).toBe(405);
    });

    test('GET /healthz with payload should return 400 Bad Request', async () => {
        const response = await request(app)
            .get('/healthz')
            .send({ payload: 'invalid' });
        expect(response.status).toBe(400);
    });

    test('GET /healthz with invalid headers should return 400 Bad Request', async () => {
        const response = await request(app)
            .get('/healthz')
            .set('Invalid-Header', 'value');
        expect(response.status).toBe(400);
    });

    test('GET /healthz with query parameters should return 400 Bad Request', async () => {
        const response = await request(app).get('/healthz').query({ key: 'value' });
        expect(response.status).toBe(400);
    });

    test('GET /healthz should return 503 Service Unavailable when an error occurs', async () => {
        const HealthCheck = require('../models/HealthCheck');

        // Check if `HealthCheck.create` exists
        if (!HealthCheck || !HealthCheck.create) {
            throw new Error('HealthCheck.create is undefined. Check your import.');
        }

        // Mock the `create` method to throw an error
        jest.spyOn(HealthCheck, 'create').mockImplementation(() => {
            throw new Error('Database failure');
        });

        const response = await request(app).get('/healthz');
        expect(response.status).toBe(503);

        jest.restoreAllMocks();
    });


    test('GET /nonexistent should return 404 Not Found', async () => {
        const response = await request(app).get('/nonexistent');
        expect(response.status).toBe(404);
    });
});