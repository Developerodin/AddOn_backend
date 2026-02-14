# Yarn Receiving API – Payload for Frontend

The frontend converts Excel (or form data) into the JSON below and sends it to the backend. No file upload: send JSON only.

---

## Endpoint

**POST** `/v1/yarn-management/yarn-receiving/process`  
**Auth:** Required (JWT). `updated_by` is taken from the authenticated user.

---

## Request Body

```json
{
  "items": [
    {
      "poNumber": "PO-2026-257",
      "packing": {
        "packingNumber": "EPR-01",
        "courierName": "Ekart",
        "courierNumber": "EPR-02",
        "vehicleNumber": "MH04BC4455",
        "challanNumber": "MH04BC5544",
        "dispatchDate": "2026-02-10",
        "estimatedDeliveryDate": "2026-02-28",
        "notes": ""
      },
      "lots": [
        {
          "lotNumber": "EW1205",
          "numberOfCones": 5,
          "totalWeight": 1901,
          "numberOfBoxes": 5,
          "poItems": [
            { "poItem": "698b191e0ba35154c81460a6", "receivedQuantity": 343 },
            { "poItem": "698b191e0ba35154c81460a7", "receivedQuantity": 343 },
            { "poItem": "698b191e0ba35154c81460a8", "receivedQuantity": 449 },
            { "poItem": "698b191e0ba35154c81460a9", "receivedQuantity": 343 },
            { "poItem": "698b191e0ba35154c81460aa", "receivedQuantity": 343 }
          ],
          "boxUpdates": [
            { "yarnName": "70/1-Sea Green-Sea Green-Nylon/Nylon", "shadeCode": "WN96793", "boxWeight": 343, "numberOfCones": 2 },
            { "yarnName": "70/1-Sea Green-Sea Green-Nylon/Nylon", "shadeCode": "WN96793", "boxWeight": 343, "numberOfCones": 2 }
          ]
        }
      ],
      "notes": "optional per-PO notes"
    }
  ],
  "notes": "optional global notes for status log"
}
```

---

## Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **items** | array | Yes | One object per PO to process. |
| **items[].poNumber** | string | Yes | PO number (e.g. `PO-2026-257`). |
| **items[].packing** | object | No | Packing/courier info. Can be `{}` if not needed. |
| **items[].packing.packingNumber** | string | No | Packing number. |
| **items[].packing.courierName** | string | No | Courier name. |
| **items[].packing.courierNumber** | string | No | Courier number. |
| **items[].packing.vehicleNumber** | string | No | Vehicle number. |
| **items[].packing.challanNumber** | string | No | Challan number. |
| **items[].packing.dispatchDate** | string | No | ISO date (e.g. `2026-02-10`). |
| **items[].packing.estimatedDeliveryDate** | string | No | ISO date. |
| **items[].packing.notes** | string | No | Packing notes. |
| **items[].lots** | array | Yes | At least one lot per PO. |

---

## Fixed pack list details (challan, courier, etc.)

Packing is sent **per item** (`items[].packing`). If the same packing applies to all POs in one request (e.g. one delivery, one challan), the frontend can let the user enter these **once** in a form and reuse them for every item.

**Pack list fields you can fix (enter once, apply to all):**

| Field | API key | Example | Notes |
|-------|---------|---------|--------|
| Packing number | `packing.packingNumber` | EPR-01 | Your ref for this packing. |
| Challan number | `packing.challanNumber` | MH04BC5544 | **Challan number** – often same for whole consignment. |
| Courier name | `packing.courierName` | Ekart | Transport / courier name. |
| Courier number | `packing.courierNumber` | EPR-02 | Courier ref / AWB, etc. |
| Vehicle number | `packing.vehicleNumber` | MH04BC4455 | Vehicle no. |
| Dispatch date | `packing.dispatchDate` | 2026-02-10 | ISO date (YYYY-MM-DD). |
| Estimated delivery date | `packing.estimatedDeliveryDate` | 2026-02-28 | ISO date. |
| Packing notes | `packing.notes` | Optional text | Any notes for this pack list. |

**Frontend behaviour:**

- Add a **“Packing / Pack list details”** section (or modal) with one set of inputs for these fields.
- On submit, when building the payload, **copy this same `packing` object** into **every** `items[].packing` (so all POs in that request share the same challan, courier, vehicle, dates, notes).
- If the user leaves a field blank, send `""` or omit it; backend treats all as optional.

**Optional:** Allow “per-PO packing” later (e.g. different challan per PO) by letting the user override packing for selected POs; otherwise keep the single fixed set above.
| **items[].lots[].lotNumber** | string | Yes | Lot number (e.g. `EW1205`). |
| **items[].lots[].numberOfCones** | number | No | Total cones in this lot. |
| **items[].lots[].totalWeight** | number | No | Total weight for this lot. |
| **items[].lots[].numberOfBoxes** | number | Yes | Number of boxes (≥ 1). |
| **items[].lots[].poItems** | array | No | Received quantity per PO line. |
| **items[].lots[].poItems[].poItem** | string | Yes | PO item `_id` (24-char hex). |
| **items[].lots[].poItems[].receivedQuantity** | number | Yes | Received quantity for that PO item. |
| **items[].lots[].boxUpdates** | array | No | One entry per box, in order. Used to set yarn name, shade, weight, cones. |
| **items[].lots[].boxUpdates[].yarnName** | string | No | Yarn name for this box. |
| **items[].lots[].boxUpdates[].shadeCode** | string | No | Shade code. |
| **items[].lots[].boxUpdates[].boxWeight** | number | No | Box weight. |
| **items[].lots[].boxUpdates[].numberOfCones** | number | No | Number of cones in this box. |
| **items[].notes** | string | No | Notes for this PO (status log). |
| **notes** | string | No | Global notes for status log. |

---

## Frontend responsibilities

1. **Resolve PO numbers** – User selects or enters PO number(s). Optionally resolve from brand/supplier if needed.
2. **Resolve PO item IDs** – For each PO, get order details (e.g. `GET /v1/yarn-management/yarn-purchase-orders/by-number/:poNumber`) and use `poItems[]._id` for `poItem` in `poItems` and for grouping.
3. **Map Excel rows to lots** – Group by lot number; aggregate `numberOfCones`, `totalWeight`, `numberOfBoxes`; build `poItems` with `receivedQuantity` per PO item.
4. **Map Excel rows to boxUpdates** – One row per box: push `{ yarnName, shadeCode, boxWeight, numberOfCones }` in the same order as boxes will be created (so first box = first element of `boxUpdates`).

---

## Response (200 OK)

```json
{
  "results": [
    {
      "poNumber": "PO-2026-257",
      "success": true,
      "message": "Processed PO PO-2026-257: 5 boxes created, 5 boxes updated.",
      "purchaseOrder": { ... },
      "boxesCreated": 5,
      "boxesUpdated": 5,
      "errors": []
    }
  ],
  "summary": {
    "total": 1,
    "success": 1,
    "failed": 0
  }
}
```

If a PO fails, that item in `results` has `success: false`, `message` and `errors` set, and `purchaseOrder` / `boxesCreated` / `boxesUpdated` as applicable.
