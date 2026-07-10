import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as ingestService from '../../services/integrations/websiteOrderIngest.service.js';
import * as outboundService from '../../services/integrations/websiteOrderOutbound.service.js';

const ingest = catchAsync(async (req, res) => {
  const result = await ingestService.ingestWebsiteOrder(req.body);
  const code = result.status === 'already_synced' ? httpStatus.OK : httpStatus.CREATED;
  res.status(code).send(result);
});

const cancel = catchAsync(async (req, res) => {
  const result = await ingestService.cancelWebsiteOrder(req.body);
  res.send(result);
});

const push = catchAsync(async (req, res) => {
  try {
    const result = await outboundService.manualPushToWebsite(req.params.warehouseOrderId);
    res.send(result);
  } catch (e) {
    throw new ApiError(httpStatus.BAD_REQUEST, e.message || 'Push failed');
  }
});

const syncLog = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['addonOrderId', 'direction', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await ingestService.querySyncLogs(filter, options);
  res.send(result);
});

export { ingest, cancel, push, syncLog };
