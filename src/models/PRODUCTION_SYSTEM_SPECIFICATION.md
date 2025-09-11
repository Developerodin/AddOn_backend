# Production System Complete Specification

## Overview
This document provides a comprehensive specification for the production management system, covering the complete flow from order creation to final delivery. The system manages 8 sequential production floors with real-time tracking, quality control, and automated transfers.

## Production Flow Architecture

```
Order Creation → Knitting → Linking → Checking → Washing → Boarding → Branding → Final Checking → Warehouse
```

## 1. Data Models

### 1.1 Core Enums

```typescript
// Order & Article Status
type OrderStatus = 'Pending' | 'In Progress' | 'Completed' | 'On Hold' | 'Cancelled';

// Priority Levels
type Priority = 'Urgent' | 'High' | 'Medium' | 'Low';

// Linking Types
type LinkingType = 'Auto Linking' | 'Rosso Linking' | 'Hand Linking';

// Production Floors
type ProductionFloor = 
  | 'Knitting' 
  | 'Linking' 
  | 'Checking' 
  | 'Washing' 
  | 'Boarding' 
  | 'Branding' 
  | 'Final Checking' 
  | 'Warehouse';

// Quality Categories (Final Checking)
type QualityCategory = 'M1' | 'M2' | 'M3' | 'M4';

// Repair Status (Final Checking)
type RepairStatus = 'Not Required' | 'In Review' | 'Repaired' | 'Rejected';
```

### 1.2 Article Log Model

```typescript
interface ArticleLog {
  id: string;                    // Unique log ID
  date: string;                  // YYYY-MM-DD format
  action: string;                // Specific action performed
  quantity: number;              // Quantity involved in action
  fromFloor?: string;            // Source floor
  toFloor?: string;              // Destination floor
  remarks?: string;              // Additional notes
  timestamp: string;             // ISO timestamp
  userId: string;                // User who performed action
  floorSupervisorId: string;     // Floor supervisor ID
  orderId: string;               // Reference to production order
  articleId: string;             // Reference to article
  previousValue?: number;        // Previous quantity/value
  newValue?: number;             // New quantity/value
  changeReason?: string;         // Reason for change
  qualityStatus?: string;        // Quality status if applicable
  machineId?: string;            // Machine/equipment used
  shiftId?: string;              // Work shift reference
  batchNumber?: string;          // Production batch reference
}
```

### 1.2.1 Log Action Types

```typescript
// Complete list of all loggable actions
type LogAction = 
  // Order Management
  | 'Order Created'
  | 'Order Updated'
  | 'Order Cancelled'
  | 'Order Put On Hold'
  | 'Order Resumed'
  | 'Order Completed'
  
  // Article Management
  | 'Article Added'
  | 'Article Updated'
  | 'Article Removed'
  | 'Article Status Changed'
  | 'Article Priority Changed'
  
  // Floor Operations
  | 'Work Started'
  | 'Work Paused'
  | 'Work Resumed'
  | 'Work Completed'
  | 'Quantity Updated'
  | 'Progress Updated'
  | 'Remarks Added'
  | 'Remarks Updated'
  
  // Floor Transfers
  | 'Transferred to Knitting'
  | 'Transferred to Linking'
  | 'Transferred to Checking'
  | 'Transferred to Washing'
  | 'Transferred to Boarding'
  | 'Transferred to Branding'
  | 'Transferred to Final Checking'
  | 'Transferred to Warehouse'
  
  // Quality Control
  | 'Quality Check Started'
  | 'Quality Check Completed'
  | 'M1 Quantity Updated'
  | 'M2 Quantity Updated'
  | 'M3 Quantity Updated'
  | 'M4 Quantity Updated'
  | 'M2 Item Shifted to M1'
  | 'M2 Item Shifted to M3'
  | 'M2 Item Shifted to M4'
  | 'Repair Started'
  | 'Repair Completed'
  | 'Repair Rejected'
  | 'Final Quality Confirmed'
  | 'Final Quality Rejected'
  
  // System Operations
  | 'Floor Statistics Updated'
  | 'Dashboard Refreshed'
  | 'Report Generated'
  | 'Export Initiated'
  | 'Backup Created'
  
  // Error and Issues
  | 'Error Occurred'
  | 'Issue Reported'
  | 'Issue Resolved'
  | 'Machine Breakdown'
  | 'Machine Repaired'
  | 'Material Shortage'
  | 'Material Received'
  
  // User Actions
  | 'User Login'
  | 'User Logout'
  | 'Permission Changed'
  | 'Password Changed'
  | 'Profile Updated';
```

### 1.3 Article Model

```typescript
interface Article {
  id: string;                    // Unique article ID
  articleNumber: string;         // 4-5 alphanumeric (e.g., ART001)
  plannedQuantity: number;       // Total planned quantity
  completedQuantity: number;     // Currently completed quantity
  linkingType: LinkingType;      // Type of linking required
  priority: Priority;            // Article priority
  status: OrderStatus;           // Current status
  progress: number;              // Progress percentage (0-100)
  currentFloor: ProductionFloor; // Current floor location
  remarks?: string;              // General remarks
  logs: ArticleLog[];            // Activity logs
  
  // Floor-specific quantities (varies by floor)
  quantityFromPreviousFloor?: number;  // Received from previous floor
  
  // Final Checking specific fields
  m1Quantity?: number;           // Good quality - ready for next step
  m2Quantity?: number;           // Needs repair - to be reviewed
  m3Quantity?: number;           // Minor defects - can be fixed
  m4Quantity?: number;           // Major defects - needs significant repair
  repairStatus?: RepairStatus;   // Repair status for M2 items
  repairRemarks?: string;        // Repair process remarks
  finalQualityConfirmed?: boolean; // Final quality confirmation
  
  // Timestamps
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  startedAt?: string;            // When work started on this floor
  completedAt?: string;          // When work completed on this floor
}
```

### 1.4 Production Order Model

```typescript
interface ProductionOrder {
  id: string;                    // Unique order ID (e.g., ORD-001)
  orderNumber: string;           // Human-readable order number
  priority: Priority;            // Overall order priority
  status: OrderStatus;           // Overall order status
  articles: Article[];           // Articles in this order
  currentFloor: ProductionFloor; // Current floor (highest progress)
  orderNote?: string;            // Order-level notes
  
  // Customer/Client Information
  customerId?: string;           // Customer reference
  customerName?: string;         // Customer name
  customerOrderNumber?: string;  // Customer's order number
  
  // Scheduling
  plannedStartDate?: string;     // Planned start date
  plannedEndDate?: string;       // Planned completion date
  actualStartDate?: string;      // Actual start date
  actualEndDate?: string;        // Actual completion date
  
  // Floor-specific flags
  forwardedToBranding?: boolean; // Final checking completion flag
  
  // Timestamps
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  createdBy: string;             // User who created the order
  lastModifiedBy: string;        // User who last modified
}
```

### 1.5 Floor Supervisor Model

```typescript
interface FloorSupervisor {
  id: string;                    // Unique supervisor ID
  name: string;                  // Supervisor name
  email: string;                 // Email address
  floor: ProductionFloor;        // Assigned floor
  isActive: boolean;             // Active status
  permissions: string[];         // Permission array
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}
```

### 1.6 Production Statistics Model

```typescript
interface FloorStatistics {
  floor: ProductionFloor;
  activeOrders: number;          // Orders currently on this floor
  completedToday: number;        // Orders completed today
  pendingOrders: number;         // Orders waiting to start
  onHoldOrders: number;          // Orders on hold
  totalQuantity: number;         // Total quantity on floor
  completedQuantity: number;     // Completed quantity
  efficiency: number;            // Floor efficiency percentage
  averageProcessingTime: number; // Average time per order (hours)
}
```

## 2. Production Flow Details

### 2.1 Floor-by-Floor Process

#### **Floor 1: Knitting**
- **Purpose**: Initial production - creates knitted materials
- **Key Actions**:
  - Updates completed knitting quantities
  - Tracks progress (planned vs completed)
  - **Auto-transfers** completed quantities to Linking floor
  - Adds remarks and quality notes
- **Data Fields**:
  - `plannedQuantity`: Total planned quantity
  - `completedQuantity`: Currently completed quantity
  - `remarks`: Quality and process notes
- **Transfer Logic**: When `completedQuantity` increases, automatically creates transfer log to Linking
- **Required Logs**:
  - `Work Started` - When work begins on this floor
  - `Quantity Updated` - Every time completed quantity changes
  - `Progress Updated` - When progress percentage changes
  - `Remarks Added/Updated` - When remarks are added or modified
  - `Transferred to Linking` - When quantity is transferred to next floor
  - `Work Completed` - When all planned quantity is completed
  - `Work Paused/Resumed` - If work is paused or resumed

#### **Floor 2: Linking**
- **Purpose**: Links knitted materials together
- **Key Actions**:
  - Receives quantities from Knitting floor
  - Updates completed linking quantities
  - **Auto-transfers** completed quantities to Checking floor
- **Data Fields**:
  - `quantityFromKnitting`: Received from previous floor
  - `completedQuantity`: Currently completed quantity
  - `linkingType`: Type of linking (Auto/Rosso/Hand)
- **Transfer Logic**: When `completedQuantity` increases, automatically creates transfer log to Checking
- **Required Logs**:
  - `Work Started` - When work begins on this floor
  - `Quantity Updated` - Every time completed quantity changes
  - `Progress Updated` - When progress percentage changes
  - `Remarks Added/Updated` - When remarks are added or modified
  - `Transferred to Checking` - When quantity is transferred to next floor
  - `Work Completed` - When all planned quantity is completed
  - `Work Paused/Resumed` - If work is paused or resumed

#### **Floor 3: Checking**
- **Purpose**: Quality inspection and checking
- **Key Actions**:
  - Receives quantities from Linking floor
  - Updates completed checking quantities
  - **Auto-transfers** completed quantities to Washing floor
- **Data Fields**:
  - `quantityFromLinking`: Received from previous floor
  - `completedQuantity`: Currently completed quantity
- **Transfer Logic**: When `completedQuantity` increases, automatically creates transfer log to Washing
- **Required Logs**:
  - `Work Started` - When work begins on this floor
  - `Quantity Updated` - Every time completed quantity changes
  - `Progress Updated` - When progress percentage changes
  - `Remarks Added/Updated` - When remarks are added or modified
  - `Transferred to Washing` - When quantity is transferred to next floor
  - `Work Completed` - When all planned quantity is completed
  - `Work Paused/Resumed` - If work is paused or resumed

#### **Floor 4: Washing**
- **Purpose**: Washing and cleaning process
- **Key Actions**:
  - Receives quantities from Checking floor
  - Updates completed washing quantities
  - **Auto-transfers** completed quantities to Boarding floor
- **Data Fields**:
  - `quantityFromChecking`: Received from previous floor
  - `completedQuantity`: Currently completed quantity
- **Transfer Logic**: When `completedQuantity` increases, automatically creates transfer log to Boarding
- **Required Logs**:
  - `Work Started` - When work begins on this floor
  - `Quantity Updated` - Every time completed quantity changes
  - `Progress Updated` - When progress percentage changes
  - `Remarks Added/Updated` - When remarks are added or modified
  - `Transferred to Boarding` - When quantity is transferred to next floor
  - `Work Completed` - When all planned quantity is completed
  - `Work Paused/Resumed` - If work is paused or resumed

#### **Floor 5: Boarding**
- **Purpose**: Boarding and shaping process
- **Key Actions**:
  - Receives quantities from Washing floor
  - Updates completed boarding quantities
  - **Auto-transfers** completed quantities to Branding floor
- **Data Fields**:
  - `quantityFromWashing`: Received from previous floor
  - `completedQuantity`: Currently completed quantity
- **Transfer Logic**: When `completedQuantity` increases, automatically creates transfer log to Branding
- **Required Logs**:
  - `Work Started` - When work begins on this floor
  - `Quantity Updated` - Every time completed quantity changes
  - `Progress Updated` - When progress percentage changes
  - `Remarks Added/Updated` - When remarks are added or modified
  - `Transferred to Branding` - When quantity is transferred to next floor
  - `Work Completed` - When all planned quantity is completed
  - `Work Paused/Resumed` - If work is paused or resumed

#### **Floor 6: Branding**
- **Purpose**: Branding and labeling process
- **Key Actions**:
  - Receives quantities from Boarding floor
  - Updates completed branding quantities
  - **Auto-transfers** completed quantities to Final Checking floor
- **Data Fields**:
  - `quantityFromBoarding`: Received from previous floor
  - `completedQuantity`: Currently completed quantity
- **Transfer Logic**: When `completedQuantity` increases, automatically creates transfer log to Final Checking
- **Required Logs**:
  - `Work Started` - When work begins on this floor
  - `Quantity Updated` - Every time completed quantity changes
  - `Progress Updated` - When progress percentage changes
  - `Remarks Added/Updated` - When remarks are added or modified
  - `Transferred to Final Checking` - When quantity is transferred to next floor
  - `Work Completed` - When all planned quantity is completed
  - `Work Paused/Resumed` - If work is paused or resumed

#### **Floor 7: Final Checking**
- **Purpose**: Final quality control and inspection
- **Key Actions**:
  - Receives quantities from Branding floor
  - **Step 4B**: Categorizes checked quantities into M1, M2, M3, M4
  - **Step 7B**: Reviews M2 items and shifts to M1/M3/M4 if repairable
  - Confirms final quality for each article
  - **Manual transfer** to Warehouse after quality confirmation
- **Data Fields**:
  - `quantityFromBranding`: Received from previous floor
  - `completedQuantity`: Currently completed quantity
  - `m1Quantity`: Good quality - ready for next step
  - `m2Quantity`: Needs repair - to be reviewed
  - `m3Quantity`: Minor defects - can be fixed
  - `m4Quantity`: Major defects - needs significant repair
  - `repairStatus`: Repair status for M2 items
  - `repairRemarks`: Repair process remarks
  - `finalQualityConfirmed`: Final quality confirmation flag
- **Transfer Logic**: Manual transfer to Warehouse only after all articles are quality confirmed
- **Required Logs**:
  - `Work Started` - When work begins on this floor
  - `Quality Check Started` - When quality inspection begins
  - `M1 Quantity Updated` - Every time M1 quantity changes
  - `M2 Quantity Updated` - Every time M2 quantity changes
  - `M3 Quantity Updated` - Every time M3 quantity changes
  - `M4 Quantity Updated` - Every time M4 quantity changes
  - `M2 Item Shifted to M1` - When M2 items are moved to M1
  - `M2 Item Shifted to M3` - When M2 items are moved to M3
  - `M2 Item Shifted to M4` - When M2 items are moved to M4
  - `Repair Started` - When repair process begins
  - `Repair Completed` - When repair process is completed
  - `Repair Rejected` - When repair is rejected
  - `Final Quality Confirmed` - When final quality is confirmed
  - `Final Quality Rejected` - When final quality is rejected
  - `Transferred to Warehouse` - When quantity is transferred to warehouse
  - `Work Completed` - When all planned quantity is completed
  - `Work Paused/Resumed` - If work is paused or resumed

#### **Floor 8: Warehouse**
- **Purpose**: Final storage and dispatch preparation
- **Key Actions**:
  - Receives quantities from Final Checking floor
  - Updates warehouse quantities
  - Marks orders as ready for dispatch
- **Data Fields**:
  - `quantityFromFinalChecking`: Received from previous floor
  - `completedQuantity`: Currently completed quantity
  - `warehouseLocation`: Storage location
  - `readyForDispatch`: Dispatch readiness flag
- **Transfer Logic**: Final destination - no further transfers
- **Required Logs**:
  - `Work Started` - When work begins on this floor
  - `Quantity Updated` - Every time completed quantity changes
  - `Progress Updated` - When progress percentage changes
  - `Remarks Added/Updated` - When remarks are added or modified
  - `Work Completed` - When all planned quantity is completed
  - `Ready for Dispatch` - When order is ready for dispatch
  - `Work Paused/Resumed` - If work is paused or resumed

### 2.2 Quality Control Process (Final Checking)

#### **Step 4B: Article-wise Checked Quantities**
- **M1 (Good Quality)**: Ready for next step
- **M2 (Needs Repair)**: To be reviewed and potentially repaired
- **M3 (Minor Defects)**: Can be fixed with minor adjustments
- **M4 (Major Defects)**: Needs significant repair or may be rejected

#### **Step 7B: M2 Repair Sub-step**
- Review M2 items for repairability
- Shift repairable items to M1, M3, or M4
- Track repair status and remarks
- Update quantities accordingly

## 3. API Endpoints Specification

### 3.1 Order Management

```typescript
// Create new production order
POST /api/production/orders
Body: {
  orderNumber: string;
  priority: Priority;
  articles: Omit<Article, 'id' | 'createdAt' | 'updatedAt' | 'logs'>[];
  orderNote?: string;
  customerId?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;
}

// Get all production orders
GET /api/production/orders
Query: {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  priority?: Priority;
  floor?: ProductionFloor;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

// Get single production order
GET /api/production/orders/:id

// Update production order
PUT /api/production/orders/:id
Body: Partial<ProductionOrder>

// Delete production order
DELETE /api/production/orders/:id
```

### 3.2 Floor Supervisor Operations

```typescript
// Get orders for specific floor
GET /api/production/floors/:floor/orders
Query: {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  priority?: Priority;
  search?: string;
}

// Update article progress on floor
PUT /api/production/floors/:floor/orders/:orderId/articles/:articleId
Body: {
  completedQuantity: number;
  remarks?: string;
  // Floor-specific fields
  m1Quantity?: number;  // Final Checking only
  m2Quantity?: number;  // Final Checking only
  m3Quantity?: number;  // Final Checking only
  m4Quantity?: number;  // Final Checking only
  repairStatus?: RepairStatus;  // Final Checking only
  repairRemarks?: string;  // Final Checking only
}

// Transfer article to next floor
POST /api/production/floors/:floor/transfer
Body: {
  orderId: string;
  articleId: string;
  quantity: number;
  remarks?: string;
}

// Get floor statistics
GET /api/production/floors/:floor/statistics
Query: {
  dateFrom?: string;
  dateTo?: string;
}
```

### 3.3 Quality Control (Final Checking)

```typescript
// Update quality categories
PUT /api/production/floors/final-checking/quality/:articleId
Body: {
  m1Quantity: number;
  m2Quantity: number;
  m3Quantity: number;
  m4Quantity: number;
  repairStatus?: RepairStatus;
  repairRemarks?: string;
}

// Shift M2 items to other categories
POST /api/production/floors/final-checking/shift-m2
Body: {
  articleId: string;
  fromM2: number;
  toM1?: number;
  toM3?: number;
  toM4?: number;
  remarks?: string;
}

// Confirm final quality
POST /api/production/floors/final-checking/confirm-quality
Body: {
  articleId: string;
  confirmed: boolean;
}

// Forward to warehouse
POST /api/production/floors/final-checking/forward-to-warehouse
Body: {
  orderId: string;
  remarks?: string;
}
```

### 3.4 Reports and Analytics

```typescript
// Get production dashboard data
GET /api/production/dashboard
Query: {
  dateFrom?: string;
  dateTo?: string;
  floor?: ProductionFloor;
}

// Get floor efficiency report
GET /api/production/reports/efficiency
Query: {
  floor?: ProductionFloor;
  dateFrom?: string;
  dateTo?: string;
}

// Get quality control report
GET /api/production/reports/quality
Query: {
  dateFrom?: string;
  dateTo?: string;
  floor?: ProductionFloor;
}

// Get order tracking report
GET /api/production/reports/order-tracking/:orderId
```

## 4. Database Schema

### 4.1 Tables Structure

```sql
-- Production Orders Table
CREATE TABLE production_orders (
  id VARCHAR(50) PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE NOT NULL,
  priority ENUM('Urgent', 'High', 'Medium', 'Low') NOT NULL,
  status ENUM('Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled') NOT NULL,
  current_floor ENUM('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse') NOT NULL,
  order_note TEXT,
  customer_id VARCHAR(50),
  customer_name VARCHAR(255),
  customer_order_number VARCHAR(100),
  planned_start_date DATE,
  planned_end_date DATE,
  actual_start_date DATE,
  actual_end_date DATE,
  forwarded_to_branding BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by VARCHAR(50) NOT NULL,
  last_modified_by VARCHAR(50) NOT NULL
);

-- Articles Table
CREATE TABLE articles (
  id VARCHAR(50) PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL,
  article_number VARCHAR(10) NOT NULL,
  planned_quantity INT NOT NULL,
  completed_quantity INT DEFAULT 0,
  linking_type ENUM('Auto Linking', 'Rosso Linking', 'Hand Linking') NOT NULL,
  priority ENUM('Urgent', 'High', 'Medium', 'Low') NOT NULL,
  status ENUM('Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled') NOT NULL,
  progress DECIMAL(5,2) DEFAULT 0.00,
  current_floor ENUM('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse') NOT NULL,
  remarks TEXT,
  quantity_from_previous_floor INT DEFAULT 0,
  m1_quantity INT DEFAULT 0,
  m2_quantity INT DEFAULT 0,
  m3_quantity INT DEFAULT 0,
  m4_quantity INT DEFAULT 0,
  repair_status ENUM('Not Required', 'In Review', 'Repaired', 'Rejected') DEFAULT 'Not Required',
  repair_remarks TEXT,
  final_quality_confirmed BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES production_orders(id) ON DELETE CASCADE
);

-- Article Logs Table
CREATE TABLE article_logs (
  id VARCHAR(50) PRIMARY KEY,
  article_id VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  action VARCHAR(255) NOT NULL,
  quantity INT NOT NULL,
  from_floor VARCHAR(50),
  to_floor VARCHAR(50),
  remarks TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_id VARCHAR(50) NOT NULL,
  floor_supervisor_id VARCHAR(50) NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- Floor Supervisors Table
CREATE TABLE floor_supervisors (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  floor ENUM('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse') NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  permissions JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Floor Statistics Table (for caching)
CREATE TABLE floor_statistics (
  id VARCHAR(50) PRIMARY KEY,
  floor ENUM('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse') NOT NULL,
  date DATE NOT NULL,
  active_orders INT DEFAULT 0,
  completed_today INT DEFAULT 0,
  pending_orders INT DEFAULT 0,
  on_hold_orders INT DEFAULT 0,
  total_quantity INT DEFAULT 0,
  completed_quantity INT DEFAULT 0,
  efficiency DECIMAL(5,2) DEFAULT 0.00,
  average_processing_time DECIMAL(8,2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_floor_date (floor, date)
);
```

### 4.2 Indexes

```sql
-- Performance indexes
CREATE INDEX idx_orders_status ON production_orders(status);
CREATE INDEX idx_orders_floor ON production_orders(current_floor);
CREATE INDEX idx_orders_priority ON production_orders(priority);
CREATE INDEX idx_orders_created_at ON production_orders(created_at);
CREATE INDEX idx_articles_order_id ON articles(order_id);
CREATE INDEX idx_articles_floor ON articles(current_floor);
CREATE INDEX idx_articles_status ON articles(status);
CREATE INDEX idx_article_logs_article_id ON article_logs(article_id);
CREATE INDEX idx_article_logs_date ON article_logs(date);
CREATE INDEX idx_floor_supervisors_floor ON floor_supervisors(floor);
CREATE INDEX idx_floor_statistics_floor_date ON floor_statistics(floor, date);
```

## 5. Comprehensive Logging Requirements

### 5.1 Mandatory Logging for Every Action

**Every single action in the system MUST be logged with complete traceability:**

#### 5.1.1 Order Creation and Management
```typescript
// When order is created
{
  action: 'Order Created',
  orderId: 'ORD-001',
  articleId: null,
  quantity: 0,
  remarks: 'Order created with 3 articles',
  previousValue: null,
  newValue: null,
  changeReason: 'New production order',
  userId: 'user123',
  floorSupervisorId: 'supervisor456'
}

// When order is updated
{
  action: 'Order Updated',
  orderId: 'ORD-001',
  articleId: null,
  quantity: 0,
  remarks: 'Order priority changed from Medium to High',
  previousValue: 'Medium',
  newValue: 'High',
  changeReason: 'Customer requested urgent delivery',
  userId: 'user123',
  floorSupervisorId: 'supervisor456'
}
```

#### 5.1.2 Article-Level Operations
```typescript
// When article is added to order
{
  action: 'Article Added',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 1000,
  remarks: 'Article ART001 added with planned quantity 1000',
  previousValue: null,
  newValue: 1000,
  changeReason: 'New article requirement',
  userId: 'user123',
  floorSupervisorId: 'supervisor456'
}

// When article quantity is updated
{
  action: 'Quantity Updated',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 250, // delta quantity
  remarks: 'Completed 250 more units',
  previousValue: 500,
  newValue: 750,
  changeReason: 'Production progress update',
  userId: 'user123',
  floorSupervisorId: 'supervisor456',
  machineId: 'MACHINE-KNIT-001',
  shiftId: 'SHIFT-A'
}
```

#### 5.1.3 Floor Transfer Operations
```typescript
// When article transfers between floors
{
  action: 'Transferred to Linking',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 750,
  remarks: '750 units completed on Knitting floor',
  fromFloor: 'Knitting',
  toFloor: 'Linking',
  previousValue: 0,
  newValue: 750,
  changeReason: 'Automatic transfer after completion',
  userId: 'user123',
  floorSupervisorId: 'supervisor456',
  batchNumber: 'BATCH-2024-001'
}
```

#### 5.1.4 Quality Control Operations (Final Checking)
```typescript
// When M1 quantity is updated
{
  action: 'M1 Quantity Updated',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 600,
  remarks: '600 units passed quality check as M1',
  previousValue: 0,
  newValue: 600,
  changeReason: 'Quality inspection completed',
  userId: 'user123',
  floorSupervisorId: 'supervisor456',
  qualityStatus: 'M1 - Good Quality'
}

// When M2 items are shifted to M1
{
  action: 'M2 Item Shifted to M1',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 50,
  remarks: '50 M2 items successfully repaired and moved to M1',
  previousValue: 100, // M2 quantity before shift
  newValue: 50,       // M2 quantity after shift
  changeReason: 'Repair process completed successfully',
  userId: 'user123',
  floorSupervisorId: 'supervisor456',
  qualityStatus: 'M1 - Good Quality'
}

// When final quality is confirmed
{
  action: 'Final Quality Confirmed',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 1000,
  remarks: 'All 1000 units passed final quality check',
  previousValue: false,
  newValue: true,
  changeReason: 'Final inspection completed',
  userId: 'user123',
  floorSupervisorId: 'supervisor456',
  qualityStatus: 'Approved for Warehouse'
}
```

#### 5.1.5 Work Status Changes
```typescript
// When work starts on a floor
{
  action: 'Work Started',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 0,
  remarks: 'Work started on Knitting floor',
  previousValue: 'Pending',
  newValue: 'In Progress',
  changeReason: 'Production floor supervisor started work',
  userId: 'user123',
  floorSupervisorId: 'supervisor456',
  machineId: 'MACHINE-KNIT-001',
  shiftId: 'SHIFT-A'
}

// When work is paused
{
  action: 'Work Paused',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 0,
  remarks: 'Work paused due to machine maintenance',
  previousValue: 'In Progress',
  newValue: 'On Hold',
  changeReason: 'Machine maintenance required',
  userId: 'user123',
  floorSupervisorId: 'supervisor456',
  machineId: 'MACHINE-KNIT-001'
}
```

#### 5.1.6 Error and Issue Logging
```typescript
// When an error occurs
{
  action: 'Error Occurred',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 0,
  remarks: 'Machine breakdown on Knitting floor',
  previousValue: 'In Progress',
  newValue: 'On Hold',
  changeReason: 'Unexpected machine failure',
  userId: 'user123',
  floorSupervisorId: 'supervisor456',
  machineId: 'MACHINE-KNIT-001'
}

// When issue is resolved
{
  action: 'Issue Resolved',
  orderId: 'ORD-001',
  articleId: 'ART001',
  quantity: 0,
  remarks: 'Machine repaired and production resumed',
  previousValue: 'On Hold',
  newValue: 'In Progress',
  changeReason: 'Machine maintenance completed',
  userId: 'user123',
  floorSupervisorId: 'supervisor456',
  machineId: 'MACHINE-KNIT-001'
}
```

### 5.2 Logging Implementation Rules

#### 5.2.1 Automatic Logging
- **Quantity Updates**: Every time `completedQuantity` changes, create log
- **Status Changes**: Every status change must be logged
- **Floor Transfers**: Every transfer between floors must be logged
- **Progress Updates**: Every progress percentage change must be logged

#### 5.2.2 Manual Logging
- **Remarks**: When user adds/updates remarks, create log
- **Quality Actions**: All quality control actions must be logged
- **Work Status**: Start, pause, resume, complete actions must be logged
- **Error Reporting**: All errors and issues must be logged

#### 5.2.3 Log Validation Rules
- **Immutable Logs**: Once created, logs cannot be modified
- **Complete Data**: Every log must have all required fields
- **User Tracking**: Every log must have userId and floorSupervisorId
- **Timestamp Accuracy**: All logs must have precise timestamps

### 5.3 Log Query and Reporting

#### 5.3.1 Log Retrieval APIs
```typescript
// Get logs for specific article
GET /api/production/logs/article/:articleId
Query: {
  dateFrom?: string;
  dateTo?: string;
  action?: LogAction;
  limit?: number;
  offset?: number;
}

// Get logs for specific order
GET /api/production/logs/order/:orderId
Query: {
  dateFrom?: string;
  dateTo?: string;
  action?: LogAction;
  floor?: ProductionFloor;
}

// Get logs for specific floor
GET /api/production/logs/floor/:floor
Query: {
  dateFrom?: string;
  dateTo?: string;
  action?: LogAction;
  userId?: string;
}

// Get logs for specific user
GET /api/production/logs/user/:userId
Query: {
  dateFrom?: string;
  dateTo?: string;
  action?: LogAction;
  floor?: ProductionFloor;
}
```

#### 5.3.2 Log Analytics
```typescript
// Get log statistics
GET /api/production/logs/statistics
Query: {
  dateFrom?: string;
  dateTo?: string;
  groupBy?: 'day' | 'week' | 'month';
  floor?: ProductionFloor;
  action?: LogAction;
}

// Get audit trail for compliance
GET /api/production/logs/audit-trail/:orderId
Query: {
  includeSystemLogs?: boolean;
  includeUserActions?: boolean;
}
```

### 5.4 Log Storage and Performance

#### 5.4.1 Database Optimization
```sql
-- Partition logs table by date for better performance
CREATE TABLE article_logs_2024_01 PARTITION OF article_logs
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Create indexes for common queries
CREATE INDEX idx_logs_article_date ON article_logs(article_id, date);
CREATE INDEX idx_logs_order_date ON article_logs(order_id, date);
CREATE INDEX idx_logs_action_date ON article_logs(action, date);
CREATE INDEX idx_logs_user_date ON article_logs(user_id, date);
CREATE INDEX idx_logs_floor_date ON article_logs(from_floor, to_floor, date);
```

#### 5.4.2 Log Archival Strategy
- **Active Logs**: Last 6 months in main table
- **Archived Logs**: Older logs moved to archive table
- **Backup Logs**: Critical logs backed up to separate system
- **Retention Policy**: 7 years for compliance requirements

## 6. Business Rules and Validation

### 5.1 Order Creation Rules
- Article numbers must be 4-5 alphanumeric characters
- Planned quantity must be between 1 and 100,000
- At least one article required per order
- Order priority affects processing sequence

### 5.2 Floor Transfer Rules
- Articles can only move forward in the production flow
- Completed quantity cannot exceed planned quantity
- Transfer logs are automatically created on quantity updates
- Previous floor must have completed work before transfer

### 5.3 Quality Control Rules (Final Checking)
- M1 + M2 + M3 + M4 quantities must equal completed quantity
- M2 items must be reviewed before final confirmation
- All articles must be quality confirmed before warehouse transfer
- Repair status must be set for M2 items

### 5.4 Data Integrity Rules
- Order status updates based on article progress
- Floor statistics updated in real-time
- Log entries are immutable once created
- User permissions validated for all operations

## 6. Real-time Features

### 6.1 WebSocket Events
```typescript
// Order updates
'order:updated' - When order status changes
'article:progress' - When article progress updates
'floor:transfer' - When article transfers between floors
'quality:confirmed' - When final quality is confirmed

// Statistics updates
'statistics:updated' - When floor statistics change
'dashboard:refresh' - When dashboard data needs refresh
```

### 6.2 Notifications
- Email alerts for urgent orders
- Floor supervisor notifications for new orders
- Quality control alerts for M2 items
- Completion notifications for order milestones

## 7. Security and Permissions

### 7.1 Role-based Access Control
- **Production Manager**: Full access to all floors and orders
- **Floor Supervisor**: Access only to assigned floor
- **Quality Controller**: Access to Final Checking floor
- **Warehouse Manager**: Access to Warehouse floor
- **Viewer**: Read-only access to assigned floors

### 7.2 Data Validation
- Input sanitization for all text fields
- Quantity validation (non-negative, within limits)
- Date validation for scheduling fields
- Permission checks for all operations

## 8. Performance Considerations

### 8.1 Caching Strategy
- Floor statistics cached for 5 minutes
- Order lists cached with pagination
- Dashboard data cached for 1 minute
- Real-time updates via WebSocket

### 8.2 Database Optimization
- Proper indexing on frequently queried fields
- Connection pooling for database access
- Query optimization for complex reports
- Archive old logs to separate table

## 9. Error Handling

### 9.1 Validation Errors
- Field-level validation with specific error messages
- Business rule validation with context
- User-friendly error messages
- Graceful degradation for partial failures

### 9.2 System Errors
- Comprehensive logging for debugging
- Fallback mechanisms for critical operations
- User notification for system issues
- Automatic retry for transient failures

## 10. Testing Strategy

### 10.1 Unit Tests
- Model validation tests
- Business logic tests
- API endpoint tests
- Database operation tests

### 10.2 Integration Tests
- End-to-end production flow tests
- Floor transfer workflow tests
- Quality control process tests
- Real-time update tests

### 10.3 Performance Tests
- Load testing for concurrent users
- Database performance under load
- WebSocket connection limits
- Memory usage optimization

This specification provides a complete foundation for implementing a production-ready manufacturing management system with all necessary components, data models, API endpoints, and business rules.
