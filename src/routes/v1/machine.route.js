import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as machineValidation from '../../validations/machine.validation.js';
import * as machineController from '../../controllers/machine.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(machineValidation.createMachine), machineController.createMachine)
  .get(validate(machineValidation.getMachines), machineController.getMachines);

router
  .route('/statistics')
  .get(machineController.getMachineStatistics);

router
  .route('/bulk-import')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(machineValidation.bulkImportMachines),
    machineController.bulkImportMachines
  );

router
  .route('/bulk-delete')
  .post(validate(machineValidation.bulkDeleteMachines), machineController.bulkDeleteMachines);

router
  .route('/status')
  .get(validate(machineValidation.getMachinesByStatus), machineController.getMachinesByStatus);

router
  .route('/floor')
  .get(validate(machineValidation.getMachinesByFloor), machineController.getMachinesByFloor);

router
  .route('/maintenance-due')
  .get(validate(machineValidation.getMachinesNeedingMaintenance), machineController.getMachinesNeedingMaintenance);

router
  .route('/supervisor/:supervisorId')
  .get(machineController.getMachinesBySupervisor);

router
  .route('/:machineId')
  .get(validate(machineValidation.getMachine), machineController.getMachine)
  .patch(validate(machineValidation.updateMachine), machineController.updateMachine)
  .delete(validate(machineValidation.deleteMachine), machineController.deleteMachine);

router
  .route('/:machineId/status')
  .patch(validate(machineValidation.updateMachineStatus), machineController.updateMachineStatus);

router
  .route('/:machineId/maintenance')
  .patch(validate(machineValidation.updateMachineMaintenance), machineController.updateMachineMaintenance);

router
  .route('/:machineId/assign-supervisor')
  .patch(validate(machineValidation.assignSupervisor), machineController.assignSupervisor);

// Machine Usage Analytics Routes
router
  .route('/:machineId/usage-analytics')
  .get(machineController.getMachineUsageAnalytics);

router
  .route('/:machineId/current-status')
  .get(machineController.getMachineCurrentStatus);

router
  .route('/:machineId/workload')
  .get(machineController.getMachineWorkload);

router
  .route('/:machineId/performance-metrics')
  .get(machineController.getMachinePerformanceMetrics);

router
  .route('/usage-overview')
  .get(machineController.getAllMachinesUsageOverview);

export default router;

/**
 * @swagger
 * tags:
 *   name: Machines
 *   description: Machine management and retrieval
 */

/**
 * @swagger
 * /machines:
 *   post:
 *     summary: Create a machine
 *     description: Only admins can create machines.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - machineCode
 *               - machineNumber
 *               - model
 *               - floor
 *               - installationDate
 *               - maintenanceRequirement
 *             properties:
 *               machineCode:
 *                 type: string
 *                 description: Unique machine code
 *               machineNumber:
 *                 type: string
 *                 description: Unique machine number
 *               needleSizeConfig:
 *                 type: array
 *                 description: Array of { needleSize, cutoffQuantity }
 *                 items:
 *                   type: object
 *                   properties:
 *                     needleSize: { type: string }
 *                     cutoffQuantity: { type: number, default: 0 }
 *               model:
 *                 type: string
 *                 description: Machine model
 *               floor:
 *                 type: string
 *                 description: Floor location
 *               status:
 *                 type: string
 *                 enum: [Active, Under Maintenance, Idle]
 *                 default: Idle
 *               assignedSupervisor:
 *                 type: string
 *                 description: User ID of assigned supervisor
 *               capacityPerShift:
 *                 type: number
 *                 minimum: 0
 *                 description: Capacity per shift
 *               capacityPerDay:
 *                 type: number
 *                 minimum: 0
 *                 description: Capacity per day
 *               installationDate:
 *                 type: string
 *                 format: date
 *                 description: Machine installation date
 *               maintenanceRequirement:
 *                 type: string
 *                 enum: [1 month, 3 months, 6 months, 12 months]
 *                 description: Maintenance frequency
 *               lastMaintenanceDate:
 *                 type: string
 *                 format: date
 *                 description: Last maintenance date
 *               maintenanceNotes:
 *                 type: string
 *                 description: Maintenance notes
 *               isActive:
 *                 type: boolean
 *                 default: true
 *             example:
 *               machineCode: M001
 *               machineNumber: MN001
 *               needleSizeConfig: [{ needleSize: "12", cutoffQuantity: 100 }]
 *               model: Brother KH-890
 *               floor: Floor 1
 *               status: Idle
 *               assignedSupervisor: 60f7b3b3b3b3b3b3b3b3b3b3
 *               capacityPerShift: 100
 *               capacityPerDay: 300
 *               installationDate: 2023-01-15
 *               maintenanceRequirement: 3 months
 *               lastMaintenanceDate: 2023-10-15
 *               maintenanceNotes: Regular maintenance completed
 *     responses:
 *       "201":
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *                $ref: '#/components/schemas/Machine'
 *       "400":
 *         description: Bad Request
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 *
 *   get:
 *     summary: Get all machines
 *     description: Only authenticated users can retrieve machines.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: machineCode
 *         schema:
 *           type: string
 *         description: Machine code
 *       - in: query
 *         name: machineNumber
 *         schema:
 *           type: string
 *         description: Machine number
 *       - in: query
 *         name: model
 *         schema:
 *           type: string
 *         description: Machine model
 *       - in: query
 *         name: floor
 *         schema:
 *           type: string
 *         description: Floor location
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Active, Under Maintenance, Idle]
 *         description: Machine status
 *       - in: query
 *         name: assignedSupervisor
 *         schema:
 *           type: string
 *         description: Assigned supervisor ID
 *       - in: query
 *         name: needleSizeConfig
 *         schema:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               needleSize: { type: string }
 *               cutoffQuantity: { type: number }
 *         description: Filter by needle config (array of { needleSize, cutoffQuantity })
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Active status
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *         description: sort by query in the form of field:desc/asc (ex. machineCode:asc)
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         default: 10
 *         description: Maximum number of machines
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Machine'
 *                 page:
 *                   type: integer
 *                   example: 1
 *                 limit:
 *                   type: integer
 *                   example: 10
 *                 totalPages:
 *                   type: integer
 *                   example: 1
 *                 totalResults:
 *                   type: integer
 *                   example: 1
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /machines/bulk-import:
 *   post:
 *     summary: Bulk import machines (create or update by ID)
 *     description: |
 *       Import multiple machines from JSON (e.g. from Excel). Max 10000 per request.
 *       Upsert - If a row has ID (Excel "ID" or API "id"/"_id") and that machine exists, the machine is updated; otherwise a new machine is created.
 *       Accepts API-shaped objects or Excel-style column names (Machine Code, Machine Number, Needles Config 1, etc.).
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - machines
 *             properties:
 *               machines:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 10000
 *                 items:
 *                   type: object
 *                   properties:
 *                     machineCode: { type: string }
 *                     machineNumber: { type: string }
 *                     model: { type: string }
 *                     floor: { type: string }
 *                     installationDate: { type: string, format: date }
 *                     maintenanceRequirement: { type: string, enum: [1 month, 3 months, 6 months, 12 months] }
 *                     status: { type: string, enum: [Active, Under Maintenance, Idle] }
 *                     assignedSupervisor: { type: string }
 *                     capacityPerShift: { type: number }
 *                     capacityPerDay: { type: number }
 *                     lastMaintenanceDate: { type: string, format: date }
 *                     nextMaintenanceDate: { type: string, format: date }
 *                     maintenanceNotes: { type: string }
 *                     needleSizeConfig:
 *                       type: array
 *                       items: { type: object, properties: { needleSize: { type: string }, cutoffQuantity: { type: number } } }
 *               batchSize:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 100
 *                 default: 50
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     total: { type: integer }
 *                     created: { type: integer }
 *                     updated: { type: integer }
 *                     failed: { type: integer }
 *                     errors: { type: array, items: { type: object } }
 *                     processingTime: { type: integer }
 *       "400":
 *         description: Bad Request
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /machines/statistics:
 *   get:
 *     summary: Get machine statistics
 *     description: Get overall machine statistics including counts by status and maintenance due.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalMachines:
 *                   type: integer
 *                 activeMachines:
 *                   type: integer
 *                 maintenanceMachines:
 *                   type: integer
 *                 idleMachines:
 *                   type: integer
 *                 maintenanceDue:
 *                   type: integer
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /machines/status:
 *   get:
 *     summary: Get machines by status
 *     description: Get machines filtered by status.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         required: true
 *         schema:
 *           type: string
 *           enum: [Active, Under Maintenance, Idle]
 *         description: Machine status
 *       - in: query
 *         name: floor
 *         schema:
 *           type: string
 *         description: Floor location
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Machine'
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /machines/floor:
 *   get:
 *     summary: Get machines by floor
 *     description: Get machines filtered by floor.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: floor
 *         required: true
 *         schema:
 *           type: string
 *         description: Floor location
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Active, Under Maintenance, Idle]
 *         description: Machine status
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Machine'
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /machines/maintenance-due:
 *   get:
 *     summary: Get machines needing maintenance
 *     description: Get machines that are due for maintenance.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: floor
 *         schema:
 *           type: string
 *         description: Floor location
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Machine'
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /machines/supervisor/{supervisorId}:
 *   get:
 *     summary: Get machines by supervisor
 *     description: Get machines assigned to a specific supervisor.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: supervisorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Supervisor user ID
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Machine'
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /machines/{id}:
 *   get:
 *     summary: Get a machine
 *     description: Get a specific machine by ID.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Machine id
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *                $ref: '#/components/schemas/Machine'
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 *       "404":
 *         $ref: '#/components/responses/NotFound'
 *
 *   patch:
 *     summary: Update a machine
 *     description: Only admins can update machines.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Machine id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               machineCode:
 *                 type: string
 *               machineNumber:
 *                 type: string
 *               needleSizeConfig:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     needleSize: { type: string }
 *                     cutoffQuantity: { type: number }
 *               model:
 *                 type: string
 *               floor:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [Active, Under Maintenance, Idle]
 *               assignedSupervisor:
 *                 type: string
 *               capacityPerShift:
 *                 type: number
 *                 minimum: 0
 *               capacityPerDay:
 *                 type: number
 *                 minimum: 0
 *               installationDate:
 *                 type: string
 *                 format: date
 *               maintenanceRequirement:
 *                 type: string
 *                 enum: [1 month, 3 months, 6 months, 12 months]
 *               lastMaintenanceDate:
 *                 type: string
 *                 format: date
 *               maintenanceNotes:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *                $ref: '#/components/schemas/Machine'
 *       "400":
 *         description: Bad Request
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 *       "404":
 *         $ref: '#/components/responses/NotFound'
 *
 *   delete:
 *     summary: Delete a machine
 *     description: Only admins can delete machines.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Machine id
 *     responses:
 *       "204":
 *         description: No content
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 *       "404":
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /machines/{id}/status:
 *   patch:
 *     summary: Update machine status
 *     description: Update machine operational status.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Machine id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [Active, Under Maintenance, Idle]
 *               maintenanceNotes:
 *                 type: string
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *                $ref: '#/components/schemas/Machine'
 *       "400":
 *         description: Bad Request
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 *       "404":
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /machines/{id}/maintenance:
 *   patch:
 *     summary: Update machine maintenance
 *     description: Update machine maintenance information.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Machine id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lastMaintenanceDate
 *             properties:
 *               lastMaintenanceDate:
 *                 type: string
 *                 format: date
 *               maintenanceNotes:
 *                 type: string
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *                $ref: '#/components/schemas/Machine'
 *       "400":
 *         description: Bad Request
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 *       "404":
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /machines/{id}/assign-supervisor:
 *   patch:
 *     summary: Assign supervisor to machine
 *     description: Assign a supervisor to a machine.
 *     tags: [Machines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Machine id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - assignedSupervisor
 *             properties:
 *               assignedSupervisor:
 *                 type: string
 *                 description: User ID of the supervisor
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *                $ref: '#/components/schemas/Machine'
 *       "400":
 *         description: Bad Request
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 *       "404":
 *         $ref: '#/components/responses/NotFound'
 */
