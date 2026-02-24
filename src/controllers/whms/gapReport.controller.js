import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as gapReportService from '../../services/whms/gapReport.service.js';

const getGapReport = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['warehouse', 'date', 'styleCode']);
  const rows = await gapReportService.getGapReport(filter);
  res.send(rows);
});

const sendRequirement = catchAsync(async (req, res) => {
  const body = req.body;
  const created = await gapReportService.sendRequirementToFactory(
    Array.isArray(body) ? body : [body],
    req.user
  );
  res.status(201).send(created);
});

export { getGapReport, sendRequirement };
