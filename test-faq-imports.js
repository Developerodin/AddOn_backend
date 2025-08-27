// Test file to verify all FAQ imports work correctly
import dotenv from 'dotenv';
import path from 'path';

// Set required environment variables for testing
process.env.NODE_ENV = 'development';
process.env.MONGODB_URL = 'mongodb://localhost:27017/test';
process.env.JWT_SECRET = 'test-secret';
process.env.OPENAI_API_KEY = 'test-key';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

console.log('🔍 Testing FAQ imports...');

try {
  // Test config import
  console.log('1. Testing config import...');
  const config = await import('./src/config/config.js');
  console.log('✅ Config imported successfully');
  console.log('   OpenAI API Key:', config.default.openai?.apiKey ? '✅ Set' : '❌ Missing');
  
  // Test model import
  console.log('\n2. Testing FAQ model import...');
  const FaqVector = await import('./src/models/faqVector.model.js');
  console.log('✅ FAQ model imported successfully');
  
  // Test service import
  console.log('\n3. Testing FAQ service import...');
  const faqService = await import('./src/services/faq.service.js');
  console.log('✅ FAQ service imported successfully');
  
  // Test controller import
  console.log('\n4. Testing FAQ controller import...');
  const faqController = await import('./src/controllers/faq.controller.js');
  console.log('✅ FAQ controller imported successfully');
  
  // Test validation import
  console.log('\n5. Testing FAQ validation import...');
  const faqValidation = await import('./src/validations/faq.validation.js');
  console.log('✅ FAQ validation imported successfully');
  
  // Test route import
  console.log('\n6. Testing FAQ route import...');
  const faqRoute = await import('./src/routes/v1/faq.route.js');
  console.log('✅ FAQ route imported successfully');
  
  console.log('\n🎉 All FAQ imports successful! The server should start without errors.');
  
} catch (error) {
  console.error('❌ Import failed:', error.message);
  console.error('Stack:', error.stack);
}
