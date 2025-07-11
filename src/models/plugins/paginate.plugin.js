/* eslint-disable no-param-reassign */

const paginate = (schema) => {
  /**
   * @typedef {Object} QueryResult
   * @property {Document[]} results - Results found
   * @property {number} page - Current page
   * @property {number} limit - Maximum number of results per page
   * @property {number} totalPages - Total number of pages
   * @property {number} totalResults - Total number of documents
   */
  /**
   * Query for documents with pagination
   * @param {Object} [filter] - Mongo filter
   * @param {Object} [options] - Query options
   * @param {string} [options.sortBy] - Sorting criteria using the format: sortField:(desc|asc). Multiple sorting criteria should be separated by commas (,)
   * @param {string} [options.populate] - Populate data fields. Hierarchy of fields should be separated by (.). Multiple populating criteria should be separated by commas (,)
   * @param {number} [options.limit] - Maximum number of results per page (default = 10)
   * @param {number} [options.page] - Current page (default = 1)
   * @returns {Promise<QueryResult>}
   */
  schema.statics.paginate = async function (filter, options) {
    let sort = '';
    if (options.sortBy) {
      const sortingCriteria = [];
      options.sortBy.split(',').forEach((sortOption) => {
        const [key, order] = sortOption.split(':');
        sortingCriteria.push((order === 'desc' ? '-' : '') + key);
      });
      sort = sortingCriteria.join(' ');
    } else {
      sort = 'createdAt';
    }

    const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
    const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;

    const countPromise = this.countDocuments(filter).exec();
    let docsPromise = this.find(filter).sort(sort).skip(skip).limit(limit);
    
    console.log('🔍 Paginate Plugin - Query filter:', JSON.stringify(filter, null, 2));
    console.log('🔍 Paginate Plugin - Sort:', sort);
    console.log('🔍 Paginate Plugin - Skip:', skip, 'Limit:', limit);

    if (options.populate) {
      options.populate.split(',').forEach((populateOption) => {
        docsPromise = docsPromise.populate(
          populateOption
            .split('.')
            .reverse()
            .reduce((a, b) => ({ path: b, populate: a }))
        );
      });
    }

    docsPromise = docsPromise.exec();

    return Promise.all([countPromise, docsPromise]).then((values) => {
      console.log('🔍 Paginate Plugin - Raw documents from query:', values[1].length, 'items');
      if (values[1].length > 0) {
        console.log('🔍 Paginate Plugin - First document raw:', JSON.stringify(values[1][0].toObject(), null, 2));
      }
      const [totalResults, results] = values;
      const totalPages = Math.ceil(totalResults / limit);
      
      console.log('🔍 Paginate Plugin - Raw results from database:', results.length, 'items');
      if (results.length > 0) {
        console.log('📋 Paginate Plugin - First result sample:', JSON.stringify(results[0], null, 2));
      }
      
      const result = {
        results,
        page,
        limit,
        totalPages,
        totalResults,
      };
      
      console.log('📊 Paginate Plugin - Final result object:', JSON.stringify(result, null, 2));
      
      return Promise.resolve(result);
    });
  };
};

export default paginate;

