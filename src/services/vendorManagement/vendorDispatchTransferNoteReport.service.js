import VendorDispatchStockTransferNote, {
  VendorDispatchStnStatus,
} from '../../models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import { resolveInvoiceNumbersByFlowId } from './vendorDispatchTransferNote.service.js';

const REPORT_MAX_ROWS = 10000;

/**
 * Flat report rows for the vendor dispatch transfer-note Excel export.
 * @param {Object} filter
 * @returns {Promise<Array<Object>>}
 */
export const getVendorDispatchTransferNoteReportRows = async (filter = {}) => {
  const mongoFilter = { status: VendorDispatchStnStatus.ACTIVE };

  if (filter.startDate || filter.endDate) {
    mongoFilter.stnDate = {};
    if (filter.startDate) mongoFilter.stnDate.$gte = new Date(filter.startDate);
    if (filter.endDate) {
      const end = new Date(filter.endDate);
      end.setHours(23, 59, 59, 999);
      mongoFilter.stnDate.$lte = end;
    }
  }

  if (filter.search) {
    const term = String(filter.search).trim();
    if (term) {
      const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      mongoFilter.$or = [
        { stnSerial: pattern },
        { categoryLabel: pattern },
        { 'lines.articleNumber': pattern },
      ];
    }
  }

  const docs = await VendorDispatchStockTransferNote.find(mongoFilter)
    .sort({ stnDate: -1 })
    .limit(REPORT_MAX_ROWS)
    .populate('createdBy', 'name email')
    .lean();

  const allLines = docs.flatMap((doc) => doc.lines || []);
  const invoiceByFlowId = await resolveInvoiceNumbersByFlowId(allLines);

  const rows = [];
  for (const doc of docs) {
    for (const line of doc.lines || []) {
      const storedInvoice = String(line.invoiceNumber ?? '').trim();
      const flowInvoice = invoiceByFlowId.get(String(line.vendorProductionFlowId ?? '')) || '';
      rows.push({
        stnSerial: doc.stnSerial,
        stnDate: doc.stnDate,
        categoryLabel: doc.categoryLabel,
        totalQty: doc.totalQty,
        totalBoxes: doc.totalBoxes,
        vpoNumber: line.vpoNumber,
        vendorName: line.vendorName,
        invoiceNumber: storedInvoice || flowInvoice,
        articleNumber: line.articleNumber,
        sapArticleNo: line.sapArticleNo,
        articleName: line.articleName,
        brand: line.brand,
        qtyInPairs: line.qtyInPairs,
        containerBarcodes: (line.containerBarcodes || []).join(', '),
        createdByName: doc.createdBy?.name || doc.createdBy?.email || '',
      });
    }
  }
  return rows;
};
