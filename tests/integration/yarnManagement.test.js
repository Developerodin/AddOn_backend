import request from 'supertest';
import faker from 'faker';
import mongoose from 'mongoose';
import httpStatus from 'http-status';
import app from '../../src/app.js';
import setupTestDB from '../utils/setupTestDB.js';
import { adminAccessToken } from '../fixtures/token.fixture.js';
import {
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
} from '../fixtures/yarnManagement.fixture.js';
import { Color, CountSize, YarnType, Supplier } from '../../src/models/index.js';

setupTestDB();

describe('Yarn Management APIs', () => {
  describe('Colors API', () => {
    describe('POST /v1/yarn-management/colors', () => {
      let newColor;

      beforeEach(() => {
        newColor = {
          name: faker.commerce.color(),
          colorCode: '#FF5733',
          status: 'active',
        };
      });

      test('should return 201 and successfully create new color if data is ok', async () => {
        const res = await request(app)
          .post('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newColor)
          .expect(httpStatus.CREATED);

        expect(res.body).toEqual({
          id: expect.anything(),
          name: newColor.name,
          colorCode: newColor.colorCode,
          status: newColor.status,
          createdAt: expect.anything(),
          updatedAt: expect.anything(),
        });

        const dbColor = await Color.findById(res.body.id);
        expect(dbColor).toBeDefined();
        expect(dbColor).toMatchObject({
          name: newColor.name,
          colorCode: newColor.colorCode,
          status: newColor.status,
        });
      });

      test('should return 401 error if access token is missing', async () => {
        await request(app).post('/v1/yarn-management/colors').send(newColor).expect(httpStatus.UNAUTHORIZED);
      });

      test('should return 400 error if color name is already taken', async () => {
        await insertColors([colorOne]);
        newColor.name = colorOne.name;

        await request(app)
          .post('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newColor)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if color code is already taken', async () => {
        await insertColors([colorOne]);
        newColor.colorCode = colorOne.colorCode;

        await request(app)
          .post('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newColor)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if color code format is invalid', async () => {
        newColor.colorCode = 'INVALID';

        await request(app)
          .post('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newColor)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if name is missing', async () => {
        delete newColor.name;

        await request(app)
          .post('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newColor)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if colorCode is missing', async () => {
        delete newColor.colorCode;

        await request(app)
          .post('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newColor)
          .expect(httpStatus.BAD_REQUEST);
      });
    });

    describe('GET /v1/yarn-management/colors', () => {
      test('should return 200 and apply the default query options', async () => {
        await insertColors([colorOne, colorTwo]);

        const res = await request(app)
          .get('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.OK);

        expect(res.body).toEqual({
          results: expect.any(Array),
          page: 1,
          limit: 10,
          totalPages: 1,
          totalResults: 2,
        });
        expect(res.body.results).toHaveLength(2);
      });

      test('should return 401 if access token is missing', async () => {
        await insertColors([colorOne, colorTwo]);

        await request(app).get('/v1/yarn-management/colors').send().expect(httpStatus.UNAUTHORIZED);
      });

      test('should correctly apply filter on name field', async () => {
        await insertColors([colorOne, colorTwo]);

        const res = await request(app)
          .get('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .query({ name: colorOne.name })
          .send()
          .expect(httpStatus.OK);

        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0].name).toBe(colorOne.name);
      });

      test('should correctly apply filter on status field', async () => {
        await insertColors([colorOne, colorTwo]);

        const res = await request(app)
          .get('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .query({ status: 'active' })
          .send()
          .expect(httpStatus.OK);

        expect(res.body.results.length).toBeGreaterThanOrEqual(2);
      });

      test('should correctly sort the returned array', async () => {
        await insertColors([colorOne, colorTwo]);

        const res = await request(app)
          .get('/v1/yarn-management/colors')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .query({ sortBy: 'name:asc' })
          .send()
          .expect(httpStatus.OK);

        expect(res.body.results).toHaveLength(2);
        expect(res.body.results[0].name <= res.body.results[1].name).toBe(true);
      });
    });

    describe('GET /v1/yarn-management/colors/:colorId', () => {
      test('should return 200 and the color object if data is ok', async () => {
        await insertColors([colorOne]);

        const res = await request(app)
          .get(`/v1/yarn-management/colors/${colorOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.OK);

        expect(res.body).toEqual({
          id: colorOne._id.toHexString(),
          name: colorOne.name,
          colorCode: colorOne.colorCode,
          status: colorOne.status,
          createdAt: expect.anything(),
          updatedAt: expect.anything(),
        });
      });

      test('should return 401 error if access token is missing', async () => {
        await insertColors([colorOne]);

        await request(app).get(`/v1/yarn-management/colors/${colorOne._id}`).send().expect(httpStatus.UNAUTHORIZED);
      });

      test('should return 400 error if colorId is not a valid mongo id', async () => {
        await request(app)
          .get('/v1/yarn-management/colors/invalidId')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 404 error if color is not found', async () => {
        const fakeId = mongoose.Types.ObjectId();

        await request(app)
          .get(`/v1/yarn-management/colors/${fakeId}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.NOT_FOUND);
      });
    });

    describe('PATCH /v1/yarn-management/colors/:colorId', () => {
      test('should return 200 and successfully update color if data is ok', async () => {
        await insertColors([colorOne]);
        const updateBody = {
          name: 'Crimson Red',
          colorCode: '#DC143C',
        };

        const res = await request(app)
          .patch(`/v1/yarn-management/colors/${colorOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(updateBody)
          .expect(httpStatus.OK);

        expect(res.body).toEqual({
          id: colorOne._id.toHexString(),
          name: updateBody.name,
          colorCode: updateBody.colorCode,
          status: colorOne.status,
          createdAt: expect.anything(),
          updatedAt: expect.anything(),
        });

        const dbColor = await Color.findById(colorOne._id);
        expect(dbColor).toMatchObject({
          name: updateBody.name,
          colorCode: updateBody.colorCode,
        });
      });

      test('should return 401 error if access token is missing', async () => {
        await insertColors([colorOne]);
        const updateBody = { name: 'Updated Name' };

        await request(app)
          .patch(`/v1/yarn-management/colors/${colorOne._id}`)
          .send(updateBody)
          .expect(httpStatus.UNAUTHORIZED);
      });

      test('should return 404 if color is not found', async () => {
        const fakeId = mongoose.Types.ObjectId();
        const updateBody = { name: 'Updated Name' };

        await request(app)
          .patch(`/v1/yarn-management/colors/${fakeId}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(updateBody)
          .expect(httpStatus.NOT_FOUND);
      });

      test('should return 400 error if color name is already taken', async () => {
        await insertColors([colorOne, colorTwo]);
        const updateBody = { name: colorTwo.name };

        await request(app)
          .patch(`/v1/yarn-management/colors/${colorOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(updateBody)
          .expect(httpStatus.BAD_REQUEST);
      });
    });

    describe('DELETE /v1/yarn-management/colors/:colorId', () => {
      test('should return 204 if data is ok', async () => {
        await insertColors([colorOne]);

        await request(app)
          .delete(`/v1/yarn-management/colors/${colorOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.NO_CONTENT);

        const dbColor = await Color.findById(colorOne._id);
        expect(dbColor).toBeNull();
      });

      test('should return 401 error if access token is missing', async () => {
        await insertColors([colorOne]);

        await request(app)
          .delete(`/v1/yarn-management/colors/${colorOne._id}`)
          .send()
          .expect(httpStatus.UNAUTHORIZED);
      });

      test('should return 404 error if color is not found', async () => {
        const fakeId = mongoose.Types.ObjectId();

        await request(app)
          .delete(`/v1/yarn-management/colors/${fakeId}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.NOT_FOUND);
      });
    });
  });

  describe('Count Sizes API', () => {
    describe('POST /v1/yarn-management/count-sizes', () => {
      let newCountSize;

      beforeEach(() => {
        newCountSize = {
          name: '80s',
          status: 'active',
        };
      });

      test('should return 201 and successfully create new count size if data is ok', async () => {
        const res = await request(app)
          .post('/v1/yarn-management/count-sizes')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newCountSize)
          .expect(httpStatus.CREATED);

        expect(res.body).toEqual({
          id: expect.anything(),
          name: newCountSize.name,
          status: newCountSize.status,
          createdAt: expect.anything(),
          updatedAt: expect.anything(),
        });

        const dbCountSize = await CountSize.findById(res.body.id);
        expect(dbCountSize).toBeDefined();
        expect(dbCountSize).toMatchObject({
          name: newCountSize.name,
          status: newCountSize.status,
        });
      });

      test('should return 400 error if count size name is already taken', async () => {
        await insertCountSizes([countSizeOne]);
        newCountSize.name = countSizeOne.name;

        await request(app)
          .post('/v1/yarn-management/count-sizes')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newCountSize)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if name is missing', async () => {
        delete newCountSize.name;

        await request(app)
          .post('/v1/yarn-management/count-sizes')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newCountSize)
          .expect(httpStatus.BAD_REQUEST);
      });
    });

    describe('GET /v1/yarn-management/count-sizes', () => {
      test('should return 200 and apply the default query options', async () => {
        await insertCountSizes([countSizeOne, countSizeTwo]);

        const res = await request(app)
          .get('/v1/yarn-management/count-sizes')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.OK);

        expect(res.body).toEqual({
          results: expect.any(Array),
          page: 1,
          limit: 10,
          totalPages: 1,
          totalResults: 2,
        });
        expect(res.body.results).toHaveLength(2);
      });
    });

    describe('GET /v1/yarn-management/count-sizes/:countSizeId', () => {
      test('should return 200 and the count size object if data is ok', async () => {
        await insertCountSizes([countSizeOne]);

        const res = await request(app)
          .get(`/v1/yarn-management/count-sizes/${countSizeOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.OK);

        expect(res.body).toEqual({
          id: countSizeOne._id.toHexString(),
          name: countSizeOne.name,
          status: countSizeOne.status,
          createdAt: expect.anything(),
          updatedAt: expect.anything(),
        });
      });
    });

    describe('PATCH /v1/yarn-management/count-sizes/:countSizeId', () => {
      test('should return 200 and successfully update count size if data is ok', async () => {
        await insertCountSizes([countSizeOne]);
        const updateBody = {
          name: '40/2',
          status: 'inactive',
        };

        const res = await request(app)
          .patch(`/v1/yarn-management/count-sizes/${countSizeOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(updateBody)
          .expect(httpStatus.OK);

        expect(res.body.name).toBe(updateBody.name);
        expect(res.body.status).toBe(updateBody.status);
      });
    });

    describe('DELETE /v1/yarn-management/count-sizes/:countSizeId', () => {
      test('should return 204 if data is ok', async () => {
        await insertCountSizes([countSizeOne]);

        await request(app)
          .delete(`/v1/yarn-management/count-sizes/${countSizeOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.NO_CONTENT);

        const dbCountSize = await CountSize.findById(countSizeOne._id);
        expect(dbCountSize).toBeNull();
      });
    });
  });

  describe('Yarn Types API', () => {
    describe('POST /v1/yarn-management/yarn-types', () => {
      let newYarnType;

      beforeEach(() => {
        newYarnType = {
          name: 'Silk',
          details: [
            {
              subtype: 'Pure Silk',
              countSize: ['20s', '30s'],
              weight: 'Light',
            },
          ],
          status: 'active',
        };
      });

      test('should return 201 and successfully create new yarn type if data is ok', async () => {
        const res = await request(app)
          .post('/v1/yarn-management/yarn-types')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newYarnType)
          .expect(httpStatus.CREATED);

        expect(res.body).toEqual({
          id: expect.anything(),
          name: newYarnType.name,
          details: newYarnType.details,
          status: newYarnType.status,
          createdAt: expect.anything(),
          updatedAt: expect.anything(),
        });

        const dbYarnType = await YarnType.findById(res.body.id);
        expect(dbYarnType).toBeDefined();
        expect(dbYarnType).toMatchObject({
          name: newYarnType.name,
          status: newYarnType.status,
        });
      });

      test('should return 400 error if yarn type name is already taken', async () => {
        await insertYarnTypes([yarnTypeOne]);
        newYarnType.name = yarnTypeOne.name;

        await request(app)
          .post('/v1/yarn-management/yarn-types')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newYarnType)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if name is missing', async () => {
        delete newYarnType.name;

        await request(app)
          .post('/v1/yarn-management/yarn-types')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newYarnType)
          .expect(httpStatus.BAD_REQUEST);
      });
    });

    describe('GET /v1/yarn-management/yarn-types', () => {
      test('should return 200 and apply the default query options', async () => {
        await insertYarnTypes([yarnTypeOne, yarnTypeTwo]);

        const res = await request(app)
          .get('/v1/yarn-management/yarn-types')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.OK);

        expect(res.body).toEqual({
          results: expect.any(Array),
          page: 1,
          limit: 10,
          totalPages: 1,
          totalResults: 2,
        });
        expect(res.body.results).toHaveLength(2);
      });
    });

    describe('GET /v1/yarn-management/yarn-types/:yarnTypeId', () => {
      test('should return 200 and the yarn type object if data is ok', async () => {
        await insertYarnTypes([yarnTypeOne]);

        const res = await request(app)
          .get(`/v1/yarn-management/yarn-types/${yarnTypeOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.OK);

        expect(res.body).toEqual({
          id: yarnTypeOne._id.toHexString(),
          name: yarnTypeOne.name,
          details: expect.arrayContaining([
            expect.objectContaining({
              subtype: yarnTypeOne.details[0].subtype,
              countSize: yarnTypeOne.details[0].countSize,
              weight: yarnTypeOne.details[0].weight,
            }),
          ]),
          status: yarnTypeOne.status,
          createdAt: expect.anything(),
          updatedAt: expect.anything(),
        });
      });
    });

    describe('PATCH /v1/yarn-management/yarn-types/:yarnTypeId', () => {
      test('should return 200 and successfully update yarn type if data is ok', async () => {
        await insertYarnTypes([yarnTypeOne]);
        const updateBody = {
          name: 'Premium Cotton',
          details: [
            {
              subtype: 'Combed Cotton',
              countSize: ['40s', '60s', '80s'],
              weight: 'Light',
            },
          ],
        };

        const res = await request(app)
          .patch(`/v1/yarn-management/yarn-types/${yarnTypeOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(updateBody)
          .expect(httpStatus.OK);

        expect(res.body.name).toBe(updateBody.name);
        expect(res.body.details).toHaveLength(1);
      });
    });

    describe('DELETE /v1/yarn-management/yarn-types/:yarnTypeId', () => {
      test('should return 204 if data is ok', async () => {
        await insertYarnTypes([yarnTypeOne]);

        await request(app)
          .delete(`/v1/yarn-management/yarn-types/${yarnTypeOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.NO_CONTENT);

        const dbYarnType = await YarnType.findById(yarnTypeOne._id);
        expect(dbYarnType).toBeNull();
      });
    });
  });

  describe('Suppliers API', () => {
    describe('POST /v1/yarn-management/suppliers', () => {
      let newSupplier;
      let testYarnType;
      let testColor;

      beforeEach(async () => {
        // Insert test yarn type and color first
        await insertYarnTypes([yarnTypeOne]);
        await insertColors([colorOne]);
        testYarnType = yarnTypeOne._id;
        testColor = colorOne._id;

        newSupplier = {
          brandName: 'New Yarn Suppliers',
          contactPersonName: 'Test Person',
          contactNumber: '+1234567890',
          email: 'test@newsupplier.com',
          address: '123 Test Street',
          gstNo: '27ATESTU9603R1ZX',
          yarnDetails: [
            {
              yarnType: testYarnType.toHexString(),
              color: testColor.toHexString(),
              shadeNumber: 'RD-001',
            },
          ],
          status: 'active',
        };
      });

      test('should return 201 and successfully create new supplier if data is ok', async () => {
        const res = await request(app)
          .post('/v1/yarn-management/suppliers')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newSupplier)
          .expect(httpStatus.CREATED);

        expect(res.body).toEqual({
          id: expect.anything(),
          brandName: newSupplier.brandName,
          contactPersonName: newSupplier.contactPersonName,
          contactNumber: newSupplier.contactNumber,
          email: newSupplier.email,
          address: newSupplier.address,
          gstNo: newSupplier.gstNo,
          yarnDetails: expect.arrayContaining([
            expect.objectContaining({
              yarnType: expect.objectContaining({
                id: testYarnType.toHexString(),
                name: yarnTypeOne.name,
              }),
              color: expect.objectContaining({
                id: testColor.toHexString(),
                name: colorOne.name,
              }),
              shadeNumber: newSupplier.yarnDetails[0].shadeNumber,
            }),
          ]),
          status: newSupplier.status,
          createdAt: expect.anything(),
          updatedAt: expect.anything(),
        });

        const dbSupplier = await Supplier.findById(res.body.id)
          .populate('yarnDetails.yarnType')
          .populate('yarnDetails.color');
        expect(dbSupplier).toBeDefined();
        expect(dbSupplier).toMatchObject({
          brandName: newSupplier.brandName,
          email: newSupplier.email,
        });
      });

      test('should return 400 error if email is already taken', async () => {
        await insertYarnTypes([yarnTypeOne]);
        await insertColors([colorOne]);
        await insertSuppliers([supplierOne]);
        newSupplier.email = supplierOne.email;

        await request(app)
          .post('/v1/yarn-management/suppliers')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newSupplier)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if GST number is already taken', async () => {
        await insertYarnTypes([yarnTypeOne]);
        await insertColors([colorOne]);
        await insertSuppliers([supplierOne]);
        newSupplier.gstNo = supplierOne.gstNo;

        await request(app)
          .post('/v1/yarn-management/suppliers')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newSupplier)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if email format is invalid', async () => {
        newSupplier.email = 'invalidEmail';

        await request(app)
          .post('/v1/yarn-management/suppliers')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newSupplier)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if contact number format is invalid', async () => {
        newSupplier.contactNumber = '123';

        await request(app)
          .post('/v1/yarn-management/suppliers')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newSupplier)
          .expect(httpStatus.BAD_REQUEST);
      });

      test('should return 400 error if GST number format is invalid', async () => {
        newSupplier.gstNo = 'INVALID';

        await request(app)
          .post('/v1/yarn-management/suppliers')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(newSupplier)
          .expect(httpStatus.BAD_REQUEST);
      });
    });

    describe('GET /v1/yarn-management/suppliers', () => {
      test('should return 200 and apply the default query options', async () => {
        await insertYarnTypes([yarnTypeOne, yarnTypeTwo]);
        await insertColors([colorOne, colorTwo]);
        await insertSuppliers([supplierOne, supplierTwo]);

        const res = await request(app)
          .get('/v1/yarn-management/suppliers')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.OK);

        expect(res.body).toEqual({
          results: expect.any(Array),
          page: 1,
          limit: 10,
          totalPages: 1,
          totalResults: 2,
        });
        expect(res.body.results).toHaveLength(2);
      });

      test('should correctly apply filter on brandName field', async () => {
        await insertYarnTypes([yarnTypeOne, yarnTypeTwo]);
        await insertColors([colorOne, colorTwo]);
        await insertSuppliers([supplierOne, supplierTwo]);

        const res = await request(app)
          .get('/v1/yarn-management/suppliers')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .query({ brandName: supplierOne.brandName })
          .send()
          .expect(httpStatus.OK);

        expect(res.body.results.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('GET /v1/yarn-management/suppliers/:supplierId', () => {
      test('should return 200 and the supplier object if data is ok', async () => {
        await insertYarnTypes([yarnTypeOne]);
        await insertColors([colorOne]);
        await insertSuppliers([supplierOne]);

        const res = await request(app)
          .get(`/v1/yarn-management/suppliers/${supplierOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.OK);

        expect(res.body).toEqual({
          id: supplierOne._id.toHexString(),
          brandName: supplierOne.brandName,
          contactPersonName: supplierOne.contactPersonName,
          contactNumber: supplierOne.contactNumber,
          email: supplierOne.email,
          address: supplierOne.address,
          gstNo: supplierOne.gstNo,
          yarnDetails: expect.arrayContaining([
            expect.objectContaining({
              yarnType: expect.objectContaining({
                id: yarnTypeOne._id.toHexString(),
                name: yarnTypeOne.name,
              }),
              color: expect.objectContaining({
                id: colorOne._id.toHexString(),
                name: colorOne.name,
              }),
              shadeNumber: supplierOne.yarnDetails[0].shadeNumber,
            }),
          ]),
          status: supplierOne.status,
          createdAt: expect.anything(),
          updatedAt: expect.anything(),
        });
      });
    });

    describe('PATCH /v1/yarn-management/suppliers/:supplierId', () => {
      test('should return 200 and successfully update supplier if data is ok', async () => {
        await insertYarnTypes([yarnTypeOne]);
        await insertColors([colorOne]);
        await insertSuppliers([supplierOne]);
        const updateBody = {
          brandName: 'Updated Brand Name',
          contactPersonName: 'Updated Person',
        };

        const res = await request(app)
          .patch(`/v1/yarn-management/suppliers/${supplierOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(updateBody)
          .expect(httpStatus.OK);

        expect(res.body.brandName).toBe(updateBody.brandName);
        expect(res.body.contactPersonName).toBe(updateBody.contactPersonName);
      });

      test('should return 400 error if email is already taken', async () => {
        await insertYarnTypes([yarnTypeOne, yarnTypeTwo]);
        await insertColors([colorOne, colorTwo]);
        await insertSuppliers([supplierOne, supplierTwo]);
        const updateBody = { email: supplierTwo.email };

        await request(app)
          .patch(`/v1/yarn-management/suppliers/${supplierOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send(updateBody)
          .expect(httpStatus.BAD_REQUEST);
      });
    });

    describe('DELETE /v1/yarn-management/suppliers/:supplierId', () => {
      test('should return 204 if data is ok', async () => {
        await insertYarnTypes([yarnTypeOne]);
        await insertColors([colorOne]);
        await insertSuppliers([supplierOne]);

        await request(app)
          .delete(`/v1/yarn-management/suppliers/${supplierOne._id}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send()
          .expect(httpStatus.NO_CONTENT);

        const dbSupplier = await Supplier.findById(supplierOne._id);
        expect(dbSupplier).toBeNull();
      });
    });
  });
});

