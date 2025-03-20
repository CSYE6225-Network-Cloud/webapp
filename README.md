# webapp

## Overview
This Node.js application provides two main APIs:

1. **Health Check API**: An endpoint (`/healthz`) for monitoring the health of the application instance.
2. **File API**: Endpoints for uploading, retrieving, and deleting files using AWS S3 storage.

---

## Health Check API
The Health Check API provides an endpoint (`/healthz`) that can be used to monitor the health of the application instance. The endpoint ensures that:
- The application can successfully interact with the database.
- It rejects any request with a body (JSON, form-data, raw, binary, GraphQL, etc.).
- It returns appropriate HTTP status codes based on the health check results.

### Features
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

## File API
The File API provides endpoints for managing file operations using AWS S3 storage. It ensures secure file handling with appropriate validations and error handling.

### Endpoints

#### Upload a file
- **Endpoint**: `POST /v1/file`
- **Description**: Uploads a single file to AWS S3 and stores its metadata in the database.
- **Request**:
    - Content-Type: `multipart/form-data`
    - Form Field: `file` (containing the file to upload)
- **Response**:
    - `201 Created`: File uploaded successfully with file metadata in the response body.
    - `400 Bad Request`: Invalid request, multiple files, or invalid headers.
    - `503 Service Unavailable`: S3 or database connectivity failed.

#### Get file metadata
- **Endpoint**: `GET /v1/file/:id`
- **Description**: Retrieves metadata for a file by its ID.
- **Response**:
    - `200 OK`: File metadata retrieved successfully.
    - `400 Bad Request`: Request contains body, content-type, or query parameters.
    - `404 Not Found`: File with the specified ID does not exist.
    - `503 Service Unavailable`: Database connectivity failed.

#### Delete a file
- **Endpoint**: `DELETE /v1/file/:id`
- **Description**: Deletes a file from S3 and its metadata from the database.
- **Response**:
    - `204 No Content`: File deleted successfully.
    - `400 Bad Request`: Request contains body, content-type, or query parameters.
    - `404 Not Found`: File with the specified ID does not exist.
    - `503 Service Unavailable`: S3 or database connectivity failed.

### Security and Error Handling
- All unsupported HTTP methods (OPTIONS, PUT, PATCH, HEAD) return `405 Method Not Allowed` with no response body.
- Request validation ensures proper headers and prevents unwanted content.
- File size is limited to 5MB.
- Body content is not allowed on GET and DELETE requests.
- All error responses return empty response bodies with appropriate status codes.

---

## Prerequisites

Before you build and deploy the application locally, ensure the following prerequisites are met:

### 1. Node.js and npm

- Install Node.js (version 14 or higher).

- Verify installation:
  ```bash
  node -v
  npm -v
  ```

### 2. MySQL

- Install MySQL (version 5.7 or higher) for local development.
- In production, the application uses AWS RDS.

### 3. AWS Resources

- AWS S3 bucket for file storage
- AWS RDS instance for database

### 4. Github Unit Tests

Unit tests are configured to check the functionalities. Unit tests are run on every PR.

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/CSYE6225-Network-Cloud/webapp.git
cd webapp
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Deployment Notes

- For EC2 deployment, the application uses userdata scripts to configure the environment.
- No manual .env file setup is required as this is handled by infrastructure code.
- The application automatically connects to the RDS database instance and S3 bucket specified by the infrastructure.

### 4. Run server locally (Development)

For local development, you will need to set up appropriate environment variables:

```bash
npm start
```

## Production Environment

In production:
- The application runs on EC2 instances
- Database is hosted on AWS RDS
- Files are stored in AWS S3
- Environment configuration is automated via userdata scripts
- No manual setup is required beyond the infrastructure deployment