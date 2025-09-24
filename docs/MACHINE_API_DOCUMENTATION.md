# Machine Management API Documentation

## Overview
The Machine Management API provides comprehensive functionality for managing industrial machines in a manufacturing environment. This includes machine registration, operational status tracking, maintenance scheduling, and supervisor assignment.

## Machine Model

### Core Fields
- **machineCode** (String, Required, Unique): Unique identifier for the machine
- **machineNumber** (String, Required, Unique): Machine serial number
- **needleSize** (String, Required): Machine needle size specification
- **model** (String, Required): Machine model name
- **floor** (String, Required): Floor location where machine is installed

### Operational Details
- **status** (Enum, Required): Current operational status
  - `Active`: Machine is currently in operation
  - `Under Maintenance`: Machine is being serviced
  - `Idle`: Machine is available but not in use
- **assignedSupervisor** (ObjectId, Optional): Reference to User model for assigned supervisor
- **capacityPerShift** (Number, Optional): Production capacity per shift
- **capacityPerDay** (Number, Optional): Production capacity per day

### Maintenance Information
- **installationDate** (Date, Required): Date when machine was installed
- **maintenanceRequirement** (Enum, Required): Maintenance frequency
  - `1 month`: Monthly maintenance
  - `3 months`: Quarterly maintenance
  - `6 months`: Semi-annual maintenance
  - `12 months`: Annual maintenance
- **lastMaintenanceDate** (Date, Optional): Date of last maintenance
- **nextMaintenanceDate** (Date, Optional): Calculated next maintenance date
- **maintenanceNotes** (String, Optional): Additional maintenance notes

### System Fields
- **isActive** (Boolean, Default: true): Soft delete flag
- **createdAt** (Date): Record creation timestamp
- **updatedAt** (Date): Record last update timestamp

## API Endpoints

### 1. Create Machine
**POST** `/api/v1/machines`

Creates a new machine record.

**Request Body:**
```json
{
  "machineCode": "M001",
  "machineNumber": "MN001",
  "needleSize": "12",
  "model": "Brother KH-890",
  "floor": "Floor 1",
  "status": "Idle",
  "assignedSupervisor": "60f7b3b3b3b3b3b3b3b3b3b3",
  "capacityPerShift": 100,
  "capacityPerDay": 300,
  "installationDate": "2023-01-15",
  "maintenanceRequirement": "3 months",
  "lastMaintenanceDate": "2023-10-15",
  "maintenanceNotes": "Regular maintenance completed"
}
```

**Response:** 201 Created
```json
{
  "id": "60f7b3b3b3b3b3b3b3b3b3b4",
  "machineCode": "M001",
  "machineNumber": "MN001",
  "needleSize": "12",
  "model": "Brother KH-890",
  "floor": "Floor 1",
  "status": "Idle",
  "assignedSupervisor": {
    "id": "60f7b3b3b3b3b3b3b3b3b3b3",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "supervisor"
  },
  "capacityPerShift": 100,
  "capacityPerDay": 300,
  "installationDate": "2023-01-15T00:00:00.000Z",
  "maintenanceRequirement": "3 months",
  "lastMaintenanceDate": "2023-10-15T00:00:00.000Z",
  "nextMaintenanceDate": "2024-01-15T00:00:00.000Z",
  "maintenanceNotes": "Regular maintenance completed",
  "isActive": true,
  "createdAt": "2023-12-01T10:00:00.000Z",
  "updatedAt": "2023-12-01T10:00:00.000Z"
}
```

### 2. Get All Machines
**GET** `/api/v1/machines`

Retrieves all machines with optional filtering and pagination.

**Query Parameters:**
- `machineCode` (String): Filter by machine code
- `machineNumber` (String): Filter by machine number
- `model` (String): Filter by machine model
- `floor` (String): Filter by floor location
- `status` (String): Filter by status (Active, Under Maintenance, Idle)
- `assignedSupervisor` (String): Filter by supervisor ID
- `needleSize` (String): Filter by needle size
- `isActive` (Boolean): Filter by active status
- `sortBy` (String): Sort field
- `sortOrder` (String): Sort order (asc, desc)
- `limit` (Number): Results per page (default: 10)
- `page` (Number): Page number (default: 1)

**Response:** 200 OK
```json
{
  "results": [
    {
      "id": "60f7b3b3b3b3b3b3b3b3b3b4",
      "machineCode": "M001",
      "machineNumber": "MN001",
      "needleSize": "12",
      "model": "Brother KH-890",
      "floor": "Floor 1",
      "status": "Active",
      "assignedSupervisor": {
        "id": "60f7b3b3b3b3b3b3b3b3b3b3",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "capacityPerShift": 100,
      "capacityPerDay": 300,
      "installationDate": "2023-01-15T00:00:00.000Z",
      "maintenanceRequirement": "3 months",
      "lastMaintenanceDate": "2023-10-15T00:00:00.000Z",
      "nextMaintenanceDate": "2024-01-15T00:00:00.000Z",
      "isActive": true,
      "createdAt": "2023-12-01T10:00:00.000Z",
      "updatedAt": "2023-12-01T10:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "totalPages": 1,
  "totalResults": 1
}
```

### 3. Get Machine by ID
**GET** `/api/v1/machines/{machineId}`

Retrieves a specific machine by its ID.

**Response:** 200 OK
```json
{
  "id": "60f7b3b3b3b3b3b3b3b3b3b4",
  "machineCode": "M001",
  "machineNumber": "MN001",
  "needleSize": "12",
  "model": "Brother KH-890",
  "floor": "Floor 1",
  "status": "Active",
  "assignedSupervisor": {
    "id": "60f7b3b3b3b3b3b3b3b3b3b3",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "supervisor"
  },
  "capacityPerShift": 100,
  "capacityPerDay": 300,
  "installationDate": "2023-01-15T00:00:00.000Z",
  "maintenanceRequirement": "3 months",
  "lastMaintenanceDate": "2023-10-15T00:00:00.000Z",
  "nextMaintenanceDate": "2024-01-15T00:00:00.000Z",
  "maintenanceNotes": "Regular maintenance completed",
  "isActive": true,
  "createdAt": "2023-12-01T10:00:00.000Z",
  "updatedAt": "2023-12-01T10:00:00.000Z"
}
```

### 4. Update Machine
**PATCH** `/api/v1/machines/{machineId}`

Updates machine information.

**Request Body:**
```json
{
  "status": "Under Maintenance",
  "maintenanceNotes": "Scheduled maintenance in progress"
}
```

**Response:** 200 OK
```json
{
  "id": "60f7b3b3b3b3b3b3b3b3b3b4",
  "machineCode": "M001",
  "machineNumber": "MN001",
  "needleSize": "12",
  "model": "Brother KH-890",
  "floor": "Floor 1",
  "status": "Under Maintenance",
  "assignedSupervisor": {
    "id": "60f7b3b3b3b3b3b3b3b3b3b3",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "capacityPerShift": 100,
  "capacityPerDay": 300,
  "installationDate": "2023-01-15T00:00:00.000Z",
  "maintenanceRequirement": "3 months",
  "lastMaintenanceDate": "2023-10-15T00:00:00.000Z",
  "nextMaintenanceDate": "2024-01-15T00:00:00.000Z",
  "maintenanceNotes": "Scheduled maintenance in progress",
  "isActive": true,
  "createdAt": "2023-12-01T10:00:00.000Z",
  "updatedAt": "2023-12-01T11:00:00.000Z"
}
```

### 5. Update Machine Status
**PATCH** `/api/v1/machines/{machineId}/status`

Updates only the machine status.

**Request Body:**
```json
{
  "status": "Active",
  "maintenanceNotes": "Maintenance completed successfully"
}
```

### 6. Update Machine Maintenance
**PATCH** `/api/v1/machines/{machineId}/maintenance`

Updates maintenance information and automatically calculates next maintenance date.

**Request Body:**
```json
{
  "lastMaintenanceDate": "2023-12-01",
  "maintenanceNotes": "Preventive maintenance completed"
}
```

### 7. Assign Supervisor
**PATCH** `/api/v1/machines/{machineId}/assign-supervisor`

Assigns a supervisor to the machine.

**Request Body:**
```json
{
  "assignedSupervisor": "60f7b3b3b3b3b3b3b3b3b3b5"
}
```

### 8. Get Machines by Status
**GET** `/api/v1/machines/status?status=Active`

Retrieves machines filtered by status.

**Query Parameters:**
- `status` (String, Required): Machine status (Active, Under Maintenance, Idle)
- `floor` (String, Optional): Filter by floor
- `sortBy` (String): Sort field
- `sortOrder` (String): Sort order
- `limit` (Number): Results per page
- `page` (Number): Page number

### 9. Get Machines by Floor
**GET** `/api/v1/machines/floor?floor=Floor 1`

Retrieves machines filtered by floor.

**Query Parameters:**
- `floor` (String, Required): Floor location
- `status` (String, Optional): Filter by status
- `sortBy` (String): Sort field
- `sortOrder` (String): Sort order
- `limit` (Number): Results per page
- `page` (Number): Page number

### 10. Get Machines Needing Maintenance
**GET** `/api/v1/machines/maintenance-due`

Retrieves machines that are due for maintenance.

**Query Parameters:**
- `floor` (String, Optional): Filter by floor
- `sortBy` (String): Sort field
- `sortOrder` (String): Sort order
- `limit` (Number): Results per page
- `page` (Number): Page number

### 11. Get Machines by Supervisor
**GET** `/api/v1/machines/supervisor/{supervisorId}`

Retrieves machines assigned to a specific supervisor.

**Query Parameters:**
- `sortBy` (String): Sort field
- `sortOrder` (String): Sort order
- `limit` (Number): Results per page
- `page` (Number): Page number

### 12. Get Machine Statistics
**GET** `/api/v1/machines/statistics`

Retrieves overall machine statistics.

**Response:** 200 OK
```json
{
  "totalMachines": 50,
  "activeMachines": 35,
  "maintenanceMachines": 5,
  "idleMachines": 10,
  "maintenanceDue": 8
}
```

### 13. Delete Machine
**DELETE** `/api/v1/machines/{machineId}`

Soft deletes a machine (sets isActive to false).

**Response:** 204 No Content

## Error Responses

### 400 Bad Request
```json
{
  "code": 400,
  "message": "Machine code already taken"
}
```

### 401 Unauthorized
```json
{
  "code": 401,
  "message": "Please authenticate"
}
```

### 403 Forbidden
```json
{
  "code": 403,
  "message": "Forbidden"
}
```

### 404 Not Found
```json
{
  "code": 404,
  "message": "Machine not found"
}
```

## Authentication

All endpoints require authentication using Bearer token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Permissions

- **getMachines**: Required for all read operations
- **manageMachines**: Required for create, update, and delete operations

## Business Logic

### Maintenance Date Calculation
When updating maintenance information, the system automatically calculates the next maintenance date based on:
- Last maintenance date
- Maintenance requirement frequency

### Status Management
Machine status can be updated independently and includes:
- Active: Machine is operational
- Under Maintenance: Machine is being serviced
- Idle: Machine is available but not in use

### Supervisor Assignment
Machines can be assigned to supervisors who are users in the system. The supervisor information is populated when retrieving machine details.

### Soft Delete
Machines are soft deleted by setting `isActive` to false, preserving historical data.

## Usage Examples

### Creating a New Machine
```bash
curl -X POST http://localhost:3000/api/v1/machines \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "machineCode": "M001",
    "machineNumber": "MN001",
    "needleSize": "12",
    "model": "Brother KH-890",
    "floor": "Floor 1",
    "installationDate": "2023-01-15",
    "maintenanceRequirement": "3 months"
  }'
```

### Getting Machines by Status
```bash
curl -X GET "http://localhost:3000/api/v1/machines/status?status=Active&floor=Floor 1" \
  -H "Authorization: Bearer <token>"
```

### Updating Maintenance
```bash
curl -X PATCH http://localhost:3000/api/v1/machines/60f7b3b3b3b3b3b3b3b3b3b4/maintenance \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "lastMaintenanceDate": "2023-12-01",
    "maintenanceNotes": "Preventive maintenance completed"
  }'
```

This API provides comprehensive machine management capabilities for manufacturing environments, including operational tracking, maintenance scheduling, and supervisor assignment.
