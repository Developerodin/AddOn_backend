import mongoose from "mongoose";
import { YarnBox, YarnCatalog, YarnCone, StorageSlot } from "../../../src/models/index.js";
import { resetSlotBarcodeCache } from "../../../src/services/yarnManagement/yarnInventory.service.js";

const LT_BARCODE = "EVAL-YM-LT";
const ST_BARCODE = "EVAL-YM-ST";

/**
 * Real catalog name patterns. Cotton rows are enough for a "cotton" TOO_MANY.
 * Weights are chosen so roundKg3 totals stay exact.
 */
export const EVAL_YARNS = [
  {
    id: "65f0e1000000000000000001",
    yarnName: "2/40s-Black-Black-Cotton/Giza Cotton",
    boxWeight: 12.5,
    cone: { coneWeight: 1.5, tearWeight: 0.25 },
    issued: { coneWeight: 0.4, tearWeight: 0.15 },
  },
  {
    id: "65f0e1000000000000000002",
    yarnName: "40s-Black-Black-Cotton/Combed",
    boxWeight: 8,
  },
  {
    id: "65f0e1000000000000000003",
    yarnName: "2/60s-Black-Black-Cotton/Giza Cotton",
  },
  {
    id: "65f0e1000000000000000004",
    yarnName: "30s-Black-Black-Cotton/Core Spun Yarn",
  },
  {
    id: "65f0e1000000000000000005",
    yarnName: "110/70-Navy-Navy-Rubber/Rubber",
    boxWeight: 4.5,
  },
  { id: "65f0e1000000000000000006", yarnName: "20s-Navy-Navy-Cotton/Combed" },
  { id: "65f0e1000000000000000007", yarnName: "20s-Red-Red-Cotton/Combed" },
  { id: "65f0e1000000000000000008", yarnName: "10s-White-White-Cotton/Combed" },
  { id: "65f0e1000000000000000009", yarnName: "16s-Green-Green-Cotton/Combed" },
  { id: "65f0e100000000000000000a", yarnName: "24s-Yellow-Yellow-Cotton/Combed" },
  { id: "65f0e100000000000000000b", yarnName: "2/20s-Olive-Olive-Cotton/Combed" },
  { id: "65f0e100000000000000000c", yarnName: "2/30s-Maroon-Maroon-Cotton/Combed" },
  { id: "65f0e100000000000000000d", yarnName: "50s-Blue-Blue-Cotton/Combed" },
  { id: "65f0e100000000000000000e", yarnName: "7s-Pink-Pink-Cotton/Combed" },
];

/**
 * Inserts eval yarns, one LT slot, one ST slot, and the boxes/cones that carry kg.
 * Replaces any previous eval yarn rows. Does not touch production orders.
 * @returns {Promise<void>}
 */
export async function insertEvalYarnStock() {
  const names = EVAL_YARNS.map((yarn) => yarn.yarnName);
  const ids = EVAL_YARNS.map((yarn) => new mongoose.Types.ObjectId(yarn.id));
  await YarnCatalog.collection.deleteMany({ $or: [{ _id: { $in: ids } }, { yarnName: { $in: names } }] });
  await YarnBox.collection.deleteMany({ yarnName: { $in: names } });
  await YarnCone.collection.deleteMany({ yarnName: { $in: names } });
  await StorageSlot.collection.deleteMany({ barcode: { $in: [LT_BARCODE, ST_BARCODE] } });

  const now = new Date("2026-01-01T00:00:00.000Z");
  await StorageSlot.collection.insertMany([
    {
      _id: new mongoose.Types.ObjectId("65f0e10000000000000000a1"),
      zoneCode: "LT",
      sectionCode: "B7-02",
      shelfNumber: 1,
      floorNumber: 1,
      label: LT_BARCODE,
      barcode: LT_BARCODE,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: new mongoose.Types.ObjectId("65f0e10000000000000000a2"),
      zoneCode: "ST",
      sectionCode: "B7-01",
      shelfNumber: 1,
      floorNumber: 1,
      label: ST_BARCODE,
      barcode: ST_BARCODE,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await YarnCatalog.collection.insertMany(
    EVAL_YARNS.map((yarn) => ({
      _id: new mongoose.Types.ObjectId(yarn.id),
      yarnName: yarn.yarnName,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }))
  );

  const boxes = EVAL_YARNS.filter((yarn) => yarn.boxWeight > 0).map((yarn) => {
    const id = new mongoose.Types.ObjectId();
    return {
      _id: id,
      boxId: `EVAL-BOX-${yarn.id.slice(-4)}`,
      poNumber: "EVAL-PO",
      barcode: id.toString(),
      yarnName: yarn.yarnName,
      yarnCatalogId: new mongoose.Types.ObjectId(yarn.id),
      boxWeight: yarn.boxWeight,
      tearweight: 0,
      storageLocation: LT_BARCODE,
      storedStatus: true,
      createdAt: now,
      updatedAt: now,
    };
  });
  if (boxes.length) await YarnBox.collection.insertMany(boxes);

  const cones = [];
  EVAL_YARNS.forEach((yarn) => {
    if (yarn.cone) {
      const id = new mongoose.Types.ObjectId();
      cones.push({
        _id: id,
        poNumber: "EVAL-PO",
        boxId: `EVAL-CONE-${yarn.id.slice(-4)}`,
        barcode: id.toString(),
        coneWeight: yarn.cone.coneWeight,
        tearWeight: yarn.cone.tearWeight,
        yarnName: yarn.yarnName,
        yarnCatalogId: new mongoose.Types.ObjectId(yarn.id),
        coneStorageId: ST_BARCODE,
        issueStatus: "not_issued",
        createdAt: now,
        updatedAt: now,
      });
    }
    if (yarn.issued) {
      const id = new mongoose.Types.ObjectId();
      cones.push({
        _id: id,
        poNumber: "EVAL-PO",
        boxId: `EVAL-ISSUED-${yarn.id.slice(-4)}`,
        barcode: id.toString(),
        coneWeight: yarn.issued.coneWeight,
        tearWeight: yarn.issued.tearWeight,
        yarnName: yarn.yarnName,
        yarnCatalogId: new mongoose.Types.ObjectId(yarn.id),
        issueStatus: "issued",
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  if (cones.length) await YarnCone.collection.insertMany(cones);
  resetSlotBarcodeCache();
}
