// Test script to debug totalNorms issue
const testData = {
  stores: [
    {
      id: "686e07930be4f239443a0059",
      storeId: "10452",
      storeName: "Store Main",
      city: "jaipur",
      addressLine1: "jaipur",
      storeNumber: "A102",
      pincode: "302026",
      contactPerson: "Aman Gupta",
      contactEmail: "akshay9610234@gmail.com",
      contactPhone: "+918290918155",
      totalNorms: 30,
      hankyNorms: 9,
      socksNorms: 11,
      towelNorms: 10
    }
  ],
  batchSize: 1
};

console.log('Test Data:', JSON.stringify(testData, null, 2));

// Test the processing logic
const storeData = testData.stores[0];
console.log('Input totalNorms:', storeData.totalNorms, typeof storeData.totalNorms);

const processedData = {
  totalNorms: storeData.totalNorms ? Number(storeData.totalNorms) : undefined,
};

console.log('Processed totalNorms:', processedData.totalNorms, typeof processedData.totalNorms); 