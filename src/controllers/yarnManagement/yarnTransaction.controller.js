import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as yarnTransactionService from '../../services/yarnManagement/yarnTransaction.service.js';

export const createYarnTransaction = catchAsync(async (req, res) => {
  const transaction = await yarnTransactionService.createYarnTransaction(req.body);
  res.status(httpStatus.CREATED).send(transaction);
});

export const getYarnTransactions = catchAsync(async (req, res) => {
  const filters = pick(req.query, ['start_date', 'end_date', 'transaction_type', 'yarn_id', 'yarn_name', 'order_id', 'orderno', 'article_id', 'article_number', 'group_by']);
  const groupBy = req.query.group_by; // 'article' or 'yarn' or undefined
  
  const transactions = await yarnTransactionService.queryYarnTransactions(filters);
  const hasOrderFilter = filters.orderno || filters.order_id;

  // If orderno or order_id is provided, default to grouping by article (since orders are created with articles)
  // Use group_by=yarn to get yarn-based grouping instead
  if (hasOrderFilter) {
    // Group by article (default when order filter is provided)
    if (!groupBy || groupBy === 'article') {
      const orderRef = filters.order_id ? { orderId: filters.order_id, orderno: filters.orderno } : filters.orderno;
      const groupedByArticle = await yarnTransactionService.groupTransactionsByArticle(transactions, orderRef);
      return res.status(httpStatus.OK).send(groupedByArticle);
    }

    // Group by yarn (when group_by=yarn is explicitly requested)
    if (groupBy === 'yarn') {
      const groupedByYarn = {};
      
      transactions.forEach(transaction => {
        const yarnKey = transaction.yarnName || 'UNKNOWN_YARN';
        
        if (!groupedByYarn[yarnKey]) {
          groupedByYarn[yarnKey] = {
            yarnName: transaction.yarnName,
            yarnCatalogId: transaction.yarnCatalogId,
            yarn: transaction.yarnCatalogId,
            transactions: [],
            totals: {
              transactionNetWeight: 0,
              transactionTotalWeight: 0,
              transactionTearWeight: 0,
              transactionConeCount: 0,
            }
          };
        }
        
        groupedByYarn[yarnKey].transactions.push(transaction);
        groupedByYarn[yarnKey].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
        groupedByYarn[yarnKey].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
        groupedByYarn[yarnKey].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
        groupedByYarn[yarnKey].totals.transactionConeCount += transaction.transactionConeCount || 0;
      });
      
      return res.status(httpStatus.OK).send(Object.values(groupedByYarn));
    }
  }
  
  // Default: return flat array (backward compatibility when no orderno is provided)
  res.status(httpStatus.OK).send(transactions);
});

export const getYarnIssuedByOrder = catchAsync(async (req, res) => {
  const { orderno } = req.params;
  const transactions = await yarnTransactionService.getYarnIssuedByOrder(orderno);
  res.status(httpStatus.OK).send(transactions);
});

export const getAllYarnIssued = catchAsync(async (req, res) => {
  const filters = pick(req.query, ['start_date', 'end_date']);
  const transactions = await yarnTransactionService.getAllYarnIssued(filters);
  res.status(httpStatus.OK).send(transactions);
});

export const getYarnTransactionById = catchAsync(async (req, res) => {
  const { transactionId } = req.params;
  const transaction = await yarnTransactionService.getYarnTransactionById(transactionId);
  res.status(httpStatus.OK).send(transaction);
});


