# webapp

## Overview
The Health Check API provides an endpoint (`/healthz`) that can be used to monitor the health of the application instance. The endpoint ensures that:
- The application can successfully interact with the database.
- It rejects any request with a body (JSON, form-data, raw, binary, GraphQL, etc.).
- It returns appropriate HTTP status codes based on the health check results.

---

## Features
1. Validates incoming requests to ensure:
    - No body is sent with the request.
    - Only the `GET` method is allowed.
2. Inserts a record into the `HealthCheck` database table to verify database connectivity.
3. Responds with appropriate HTTP status codes:
    - `200 OK`: Health check passed.
    - `503 Service Unavailable`: Database connectivity failed.
    - `400 Bad Request`: Request contains a body.
    - `405 Method Not Allowed`: HTTP method other than `GET` is used.

---
## Prerequisites

Before you build and deploy the application locally, ensure the following prerequisites are met:

### 1. Node.js and npm

- Install Node.js (version 14 or higher).

- Verify installation:
  ```bash
  node -v
  npm -v

### 2. MySQL

- Install MySQL (version 5.7 or higher) on your local machine.

- Ensure the MySQL server is running.

- Create a MySQL user with appropriate permissions.

### 3. Environment Variables

- Create a .env file in the root directory of the project.

- Define the following environment variables:
  ```plaintext
  DB_HOST=localhost
  DB_USER=your_database_user
  DB_PASSWORD=your_database_password
  DB_NAME=health_check
  DB_PORT=3306
  PORT = 8080

## Setup Instructions

### 1. Clone the Repository

    git clone https://github.com/CSYE6225-Network-Cloud/webapp.git
    cd webapp

### 2. Install Dependencies

    npm install

### 3. Configure Environment Variables

Create a `.env` file in the root directory and provide the following:

    DB_HOST=localhost
    DB_USER=<your_database_user>
    DB_PASSWORD=<your_database_password>
    DB_NAME=health_check
    DB_PORT=3306
    PORT = 8080

### 4. Run server
    npm start