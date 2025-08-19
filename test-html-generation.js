import { testHTMLGeneration } from './src/services/chatbot.service.js';

// Sample analytics dashboard data structure
const sampleAnalyticsData = {
  timeBasedTrends: [
    {
      date: "2025-05-10T00:00:00.000Z",
      totalQuantity: 236,
      totalNSV: 69290.29,
      totalGSV: 77514,
      totalDiscount: 8223.71,
      totalTax: 3875.7,
      recordCount: 81
    },
    {
      date: "2025-05-11T00:00:00.000Z",
      totalQuantity: 280,
      totalNSV: 86691,
      totalGSV: 96470,
      totalDiscount: 9779,
      totalTax: 4823.5,
      recordCount: 92
    }
  ],
  storePerformance: [
    {
      storeName: "Store MUM-178",
      storeId: "20177",
      city: "Mumbai",
      totalQuantity: 80,
      totalNSV: 24284.7,
      totalGSV: 26670,
      totalDiscount: 2385.3,
      totalTax: 1333.5,
      recordCount: 29
    }
  ],
  brandPerformance: [
    {
      brandName: "Another Brand",
      totalQuantity: 16050,
      totalNSV: 5006663.63,
      totalGSV: 5562900,
      totalDiscount: 556236.37,
      recordCount: 5342
    }
  ],
  summaryKPIs: {
    totalQuantity: 16152,
    totalNSV: 5036771.55,
    totalGSV: 5595748,
    totalDiscount: 558976.45,
    totalTax: 279787.4,
    recordCount: 5372,
    avgDiscountPercentage: 10
  }
};

console.log('🧪 Testing HTML Generation for Analytics Dashboard...\n');

try {
  const html = testHTMLGeneration('dashboard', sampleAnalyticsData);
  
  console.log('✅ HTML Generation Successful!');
  console.log('📏 HTML Length:', html.length);
  console.log('🔍 HTML Preview (first 500 chars):');
  console.log(html.substring(0, 500) + '...');
  
  // Check if key elements are present
  const hasKPIs = html.includes('Summary KPIs');
  const hasTimeTrends = html.includes('Time-Based Trends');
  const hasStorePerformance = html.includes('Top Store Performance');
  const hasBrandPerformance = html.includes('Brand Performance');
  const hasChartJS = html.includes('Chart.js');
  
  console.log('\n📊 Content Check:');
  console.log('  Summary KPIs:', hasKPIs ? '✅' : '❌');
  console.log('  Time Trends:', hasTimeTrends ? '✅' : '❌');
  console.log('  Store Performance:', hasStorePerformance ? '✅' : '❌');
  console.log('  Brand Performance:', hasBrandPerformance ? '✅' : '❌');
  console.log('  Chart.js Library:', hasChartJS ? '✅' : '❌');
  
  if (hasKPIs && hasTimeTrends && hasStorePerformance && hasBrandPerformance && hasChartJS) {
    console.log('\n🎉 All components present! HTML generation is working correctly.');
  } else {
    console.log('\n⚠️  Some components are missing. Check the HTML generation logic.');
  }
  
} catch (error) {
  console.error('❌ HTML Generation Failed:', error.message);
  console.error('Stack:', error.stack);
}
