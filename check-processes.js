import mongoose from 'mongoose';
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

// Check if processes exist
const checkProcesses = async () => {
  try {
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

    console.log('Checking for processes with names:', processNames);
    
    const processes = await Process.find({ 
      name: { $in: processNames }
    }).select('_id name status');
    
    console.log(`\nFound ${processes.length} processes:`);
    processes.forEach(process => {
      console.log(`- ${process.name} (ID: ${process._id}, Status: ${process.status})`);
    });

    const missingProcesses = processNames.filter(name => 
      !processes.some(process => process.name === name)
    );

    if (missingProcesses.length > 0) {
      console.log(`\n⚠️  Missing processes: ${missingProcesses.join(', ')}`);
    } else {
      console.log('\n✅ All required processes found!');
    }

  } catch (error) {
    console.error('Error checking processes:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await checkProcesses();
  } catch (error) {
    console.error('Script failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  }
};

main();
