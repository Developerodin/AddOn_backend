# Machine Bulk Import – Excel to JSON

This guide explains how to convert your Excel sheet into the JSON payload for **POST /v1/machines/bulk-import**.

---

## 1. Upsert behaviour (ID in Excel)

- **If a row has an ID** (Excel column `ID` or API `id` / `_id`) **and that ID exists** in the database → the existing machine is **updated**.
- **If the row has no ID, or the ID does not exist** → a **new** machine is **created**.

So you can use the same Excel for both creating new machines and updating existing ones: include the machine’s `_id` in the `ID` column for rows you want to update.

---

## 2. Excel column → API field mapping

The backend accepts **either**:

- **API-shaped** objects: `machineCode`, `machineNumber`, `needleSizeConfig`, etc., or  
- **Excel-shaped** rows: first row = headers, same names as below. The service normalizes both.

Use these column names in your Excel (exact match recommended; spaces matter for Excel-style keys):

| Excel column name              | API field              | Type / notes |
|--------------------------------|------------------------|--------------|
| ID                             | upsert key             | If present and valid existing machine _id → **update**; else **create**. |
| Machine Code                   | machineCode            | string, required (or Machine Number) |
| Machine Number                 | machineNumber          | string, required (or Machine Code) |
| Model                          | model                  | string |
| Floor                          | floor                  | string |
| Installation Date              | installationDate       | date (YYYY-MM-DD or Excel date) |
| Maintenance Requirement        | maintenanceRequirement | `1 month`, `3 months`, `6 months`, `12 months` |
| Status                         | status                 | `Active`, `Under Maintenance`, `Idle` |
| Assigned Supervisor            | assignedSupervisor     | User ObjectId (MongoDB ID) |
| Capacity Per Shift             | capacityPerShift       | number |
| Capacity Per Day               | capacityPerDay         | number |
| Last Maintenance Date         | lastMaintenanceDate    | date |
| Next Maintenance Date         | nextMaintenanceDate    | date |
| Maintenance Notes             | maintenanceNotes       | string |
| Company Machine Type           | machineType            | string |
| Needles Config 1               | needleSizeConfig[0].needleSize | string |
| Needles Config Cutoff 1        | needleSizeConfig[0].cutoffQuantity | number |
| Needles Config 2 … Cutoff 2    | needleSizeConfig[1]    | same pattern |
| … up to Needles Config 7 / Cutoff 7 | needleSizeConfig[6] | up to 7 entries |

Only **Machine Code** or **Machine Number** (one of them) is required per row. All other columns are optional.

---

## 3. Frontend: Convert Excel file to JSON (e.g. SheetJS / xlsx)

Install:

```bash
npm install xlsx
# or
yarn add xlsx
```

Example: read the first sheet, use first row as headers, build `machines` array and POST.

```javascript
import * as XLSX from 'xlsx';

function excelToMachines(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', dateNF: 'YYYY-MM-DD' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, {
          defval: '',
          raw: false,
          dateNF: 'yyyy-mm-dd',
        });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function uploadMachinesExcel(file) {
  const machines = await excelToMachines(file);
  const response = await fetch('/v1/machines/bulk-import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${yourAuthToken}`,
    },
    body: JSON.stringify({
      machines,
      batchSize: 50,
    }),
  });
  const result = await response.json();
  return result;
}
```

- **Column names**: Keep your Excel headers exactly as in the table above (e.g. `Machine Code`, `Machine Number`, `Needles Config 1`, `Needles Config Cutoff 1`). The API accepts these Excel-style keys and normalizes them.
- **Dates**: Use `dateNF: 'yyyy-mm-dd'` so dates come out as ISO-friendly strings; the backend will parse them.
- **Empty rows**: You can filter before sending: `machines = rows.filter((r) => r['Machine Code'] || r['Machine Number'])`.

---

## 4. Example request body (after Excel → JSON)

Minimal (one machine, API-shaped):

```json
{
  "machines": [
    {
      "machineCode": "M001",
      "machineNumber": "MN001",
      "model": "Brother KH-890",
      "floor": "Floor 1",
      "installationDate": "2023-01-15",
      "maintenanceRequirement": "3 months",
      "status": "Idle",
      "capacityPerShift": 100,
      "capacityPerDay": 300,
      "needleSizeConfig": [
        { "needleSize": "12", "cutoffQuantity": 100 },
        { "needleSize": "14", "cutoffQuantity": 80 }
      ]
    }
  ],
  "batchSize": 50
}
```

Same row as **Excel-shaped** (e.g. after `sheet_to_json` with your headers):

```json
{
  "machines": [
    {
      "ID": 1,
      "Machine Code": "M001",
      "Machine Number": "MN001",
      "Model": "Brother KH-890",
      "Floor": "Floor 1",
      "Installation Date": "2023-01-15",
      "Maintenance Requirement": "3 months",
      "Status": "Idle",
      "Capacity Per Shift": 100,
      "Capacity Per Day": 300,
      "Needles Config 1": "12",
      "Needles Config Cutoff 1": 100,
      "Needles Config 2": "14",
      "Needles Config Cutoff 2": 80
    }
  ],
  "batchSize": 50
}
```

Both shapes are accepted by **POST /v1/machines/bulk-import**.

---

## 5. Example response

```json
{
  "success": true,
  "message": "Imported 15 machines: 10 created, 5 updated. 0 failed.",
  "data": {
    "total": 15,
    "created": 10,
    "updated": 5,
    "failed": 0,
    "errors": [],
    "processingTime": 234
  }
}
```

If some rows fail (e.g. duplicate machine code), `data.errors` will contain `{ row, message, machineCode?, machineNumber? }` for each failed row.

---

## 6. API summary

| Item        | Value                      |
|------------|----------------------------|
| Method     | POST                       |
| URL        | `/v1/machines/bulk-import` |
| Body       | `{ machines: [...], batchSize?: number }` |
| Max rows   | 10,000 per request         |
| batchSize  | Optional, default 50, max 100 |
