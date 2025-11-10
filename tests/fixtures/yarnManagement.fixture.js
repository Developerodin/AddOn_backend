import mongoose from 'mongoose';
import { Color, CountSize, YarnType, Supplier } from '../../src/models/index.js';

const colorOne = {
  _id: mongoose.Types.ObjectId(),
  name: 'Red',
  colorCode: '#FF5733',
  status: 'active',
};

const colorTwo = {
  _id: mongoose.Types.ObjectId(),
  name: 'Blue',
  colorCode: '#3366FF',
  status: 'active',
};

const countSizeOne = {
  _id: mongoose.Types.ObjectId(),
  name: '40s',
  status: 'active',
};

const countSizeTwo = {
  _id: mongoose.Types.ObjectId(),
  name: '60s',
  status: 'active',
};

const yarnTypeOne = {
  _id: mongoose.Types.ObjectId(),
  name: 'Cotton',
  details: [
    {
      subtype: 'Combed Cotton',
      countSize: ['40s', '60s'],
      weight: 'Light',
    },
  ],
  status: 'active',
};

const yarnTypeTwo = {
  _id: mongoose.Types.ObjectId(),
  name: 'Polyester',
  details: [
    {
      subtype: 'Polyester Blend',
      countSize: ['30s', '40s'],
      weight: 'Medium',
    },
  ],
  status: 'active',
};

const supplierOne = {
  _id: mongoose.Types.ObjectId(),
  brandName: 'ABC Yarn Suppliers',
  contactPersonName: 'John Doe',
  contactNumber: '+1234567890',
  email: 'contact@abcyarn.com',
  address: '123 Yarn Street, Textile City, TC 12345',
  gstNo: '27AABCU9603R1ZX',
  yarnDetails: [
    {
      yarnType: 'Cotton',
      color: 'Red',
      shadeNumber: 'RD-001',
    },
  ],
  status: 'active',
};

const supplierTwo = {
  _id: mongoose.Types.ObjectId(),
  brandName: 'XYZ Textiles',
  contactPersonName: 'Jane Smith',
  contactNumber: '+1987654321',
  email: 'info@xyztextiles.com',
  address: '456 Fabric Avenue, Textile City, TC 12345',
  gstNo: '29BXYZU9603R1ZY',
  yarnDetails: [
    {
      yarnType: 'Polyester',
      color: 'Blue',
      shadeNumber: 'BL-002',
    },
  ],
  status: 'active',
};

const insertColors = async (colors) => {
  await Color.insertMany(colors);
};

const insertCountSizes = async (countSizes) => {
  await CountSize.insertMany(countSizes);
};

const insertYarnTypes = async (yarnTypes) => {
  await YarnType.insertMany(yarnTypes);
};

const insertSuppliers = async (suppliers) => {
  await Supplier.insertMany(suppliers);
};

export {
  colorOne,
  colorTwo,
  countSizeOne,
  countSizeTwo,
  yarnTypeOne,
  yarnTypeTwo,
  supplierOne,
  supplierTwo,
  insertColors,
  insertCountSizes,
  insertYarnTypes,
  insertSuppliers,
};

