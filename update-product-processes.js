import mongoose from 'mongoose';
import Product from './src/models/product.model.js';
import Process from './src/models/process.model.js';
import config from './src/config/config.js';

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Main function to update product processes
const updateProductProcesses = async () => {
  try {
    console.log('Starting product processes update...');
    
    // Process names to add (excluding 'Linking' as it doesn't exist in DB)
    const processNames = [
      'Knitting',
      'Linking',
      'Checking',
      'Washing',
      'Boarding',
      'Final Checking',
      'Branding',
      'Warehouse'
    ];

    // Step 1: Get process IDs by names
    console.log('Fetching process IDs...');
    const processes = await Process.find({ 
      name: { $in: processNames },
      status: 'active' 
    }).select('_id name');
    
    console.log(`Found ${processes.length} processes:`, processes.map(p => ({ id: p._id, name: p.name })));
    
    if (processes.length === 0) {
      console.log('No processes found with the specified names');
      return;
    }

    // Step 2: Empty processes array from all products
    console.log('Emptying processes array from all products...');
    const emptyResult = await Product.updateMany(
      {},
      { $set: { processes: [] } }
    );
    console.log(`Updated ${emptyResult.modifiedCount} products - emptied processes array`);

    // Step 3: Add processes to all products
    console.log('Adding processes to all products...');
    const processItems = processes.map(process => ({
      processId: process._id
    }));

    const addResult = await Product.updateMany(
      {},
      { $set: { processes: processItems } }
    );
    console.log(`Updated ${addResult.modifiedCount} products - added processes`);

    // Step 4: Verify the update
    console.log('Verifying update...');
    const sampleProduct = await Product.findOne().populate('processes.processId', 'name');
    console.log('Sample product processes:', sampleProduct?.processes);

    console.log('✅ Product processes update completed successfully!');
    
  } catch (error) {
    console.error('❌ Error updating product processes:', error);
    throw error;
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await updateProductProcesses();
  } catch (error) {
    console.error('Script failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  }
};

// Run the script
main();
