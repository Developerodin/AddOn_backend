import httpStatus from 'http-status';
import { YarnGrn } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import {
  MONTHLY_SUMMARY_GRN_CAP,
  buildMonthlySummaryFilter,
  computeMonthlySummaryTotals,
  flattenGrnsToSummaryRows,
  paginateMonthlySummaryRows,
} from './yarnGrnMonthlySummary.util.js';

/**
 * Active GRNs in an IST calendar month, flattened to one yarn-line per row.
 * Pagination is on flattened lines; totals are month-true (not page-true).
 * @param {{ year?: number, month?: number, supplierName?: string, page?: number, limit?: number }} params
 * @returns {Promise<Object>}
 */
export const queryMonthlySummary = async (params = {}) => {
  const { filter, period } = buildMonthlySummaryFilter(params);
  const count = await YarnGrn.countDocuments(filter);
  if (count > MONTHLY_SUMMARY_GRN_CAP) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Too many GRNs in this month (${count}). Narrow by supplier.`
    );
  }

  const grns = await YarnGrn.find(filter).sort({ grnDate: -1, grnNumber: -1 }).lean();
  const allRows = flattenGrnsToSummaryRows(grns);
  const totals = computeMonthlySummaryTotals(allRows);
  const page = paginateMonthlySummaryRows(allRows, params.page, params.limit);

  return {
    year: period.year,
    month: period.month,
    results: page.results,
    totals,
    page: page.page,
    limit: page.limit,
    totalPages: page.totalPages,
    totalResults: page.totalResults,
  };
};
