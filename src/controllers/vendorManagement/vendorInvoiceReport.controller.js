import pick from '../../utils/pick.js';
import catchAsync from '../../utils/catchAsync.js';
import * as vendorInvoiceReportService from '../../services/vendorManagement/vendorInvoiceReport.service.js';

/**
 * GET /vendor-management/vendor-invoice-report
 */
export const getVendorInvoiceReport = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['search', 'from', 'to']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await vendorInvoiceReportService.queryVendorInvoiceReport(filter, options);
  res.send(result);
});
