import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { Supplier, YarnType, Color, YarnCatalog } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { runSyncForSupplier } from './supplierYarnCatalogSync.js';

/**
 * Convert yarnDetails IDs to embedded objects
 * Also handles yarnName lookup from catalog to populate yarnType and yarnSubtype
 * @param {Array} yarnDetails - Supplier yarnDetails array
 */
const convertYarnDetailsToEmbedded = async (yarnDetails) => {
  if (!yarnDetails || !Array.isArray(yarnDetails)) return;
  
  for (const detail of yarnDetails) {
    // Preserve original yarnName if provided (don't overwrite it)
    const originalYarnName = detail.yarnName ? String(detail.yarnName).trim() : null;

    // Validate that either yarnName, yarnType, or yarnCatalogId is provided
    if (!detail.yarnName && !detail.yarnType && !detail.yarnCatalogId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Either yarnName, yarnType, or yarnCatalogId must be provided in yarnDetails'
      );
    }

    // If yarnCatalogId is provided, fetch catalog and populate yarnName / yarnType / yarnsubtype
    if (detail.yarnCatalogId) {
      try {
        const catalogId = mongoose.Types.ObjectId.isValid(detail.yarnCatalogId)
          ? detail.yarnCatalogId
          : new mongoose.Types.ObjectId(detail.yarnCatalogId);
        const catalog = await YarnCatalog.findById(catalogId);
        if (catalog) {
          if (!detail.yarnName) detail.yarnName = catalog.yarnName;
          if (!detail.yarnType && catalog.yarnType) {
            detail.yarnType = {
              _id: catalog.yarnType._id,
              name: catalog.yarnType.name,
              status: catalog.yarnType.status,
            };
          }
          if (!detail.yarnsubtype && catalog.yarnSubtype) {
            detail.yarnsubtype = {
              _id: catalog.yarnSubtype._id,
              subtype: catalog.yarnSubtype.subtype,
              countSize: catalog.yarnSubtype.countSize || [],
            };
          }
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error('Error fetching yarn catalog by yarnCatalogId:', error);
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid or not found yarnCatalogId');
      }
    }

    // If yarnName is provided, optionally fetch from catalog and set yarnCatalogId (no error if not found)
    if (detail.yarnName && (!detail.yarnType || !detail.yarnsubtype || !detail.yarnCatalogId)) {
      try {
        const catalog = await YarnCatalog.findOne({
          yarnName: detail.yarnName.trim(),
          status: { $ne: 'deleted' },
        });
        if (catalog) {
          detail.yarnCatalogId = catalog._id;
          if (!detail.yarnType && catalog.yarnType) {
            detail.yarnType = {
              _id: catalog.yarnType._id,
              name: catalog.yarnType.name,
              status: catalog.yarnType.status,
            };
          }
          if (!detail.yarnsubtype && catalog.yarnSubtype) {
            detail.yarnsubtype = {
              _id: catalog.yarnSubtype._id,
              subtype: catalog.yarnSubtype.subtype,
              countSize: catalog.yarnSubtype.countSize || [],
            };
          }
        }
        // If no catalog found: allow save without yarnCatalogId (yarnName stored as-is)
      } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error('Error fetching yarn catalog by yarnName:', error);
        // Don't throw; continue without catalog link
      }
    }

    // Restore original yarnName to preserve it exactly as provided (no modifications)
    if (originalYarnName) {
      detail.yarnName = originalYarnName;
    }
    
    // Convert yarnType ID to embedded object
    if (detail.yarnType) {
      const isObjectId = mongoose.Types.ObjectId.isValid(detail.yarnType) || 
                        (typeof detail.yarnType === 'string' && mongoose.Types.ObjectId.isValid(detail.yarnType)) ||
                        (detail.yarnType && typeof detail.yarnType === 'object' && !detail.yarnType.name);
      
      if (isObjectId) {
        try {
          const yarnTypeId = mongoose.Types.ObjectId.isValid(detail.yarnType) 
            ? detail.yarnType 
            : new mongoose.Types.ObjectId(detail.yarnType);
          const yarnType = await YarnType.findById(yarnTypeId);
          
          if (yarnType) {
            detail.yarnType = {
              _id: yarnType._id,
              name: yarnType.name,
              status: yarnType.status,
            };
          } else {
            detail.yarnType = {
              _id: yarnTypeId,
              name: 'Unknown',
              status: 'deleted',
            };
          }
        } catch (error) {
          console.error('Error converting yarnType to embedded object:', error);
        }
      }
    }
    
    // Convert color ID to embedded object
    // Preserve colorName/pantoneName from request (detail.colorName, detail.pantoneName) or from detail.color object
    if (detail.color) {
      const originalColorName =
        (detail.colorName && String(detail.colorName).trim()) ||
        (detail.color && typeof detail.color === 'object' && detail.color.name && String(detail.color.name).trim()) ||
        null;
      const originalPantoneName =
        (detail.pantoneName != null && detail.pantoneName !== '' && String(detail.pantoneName).trim()) ||
        (detail.color && typeof detail.color === 'object' && detail.pantoneName != null && String(detail.pantoneName).trim()) ||
        null;

      const isObjectId = mongoose.Types.ObjectId.isValid(detail.color) ||
                        (typeof detail.color === 'string' && mongoose.Types.ObjectId.isValid(detail.color)) ||
                        (detail.color && typeof detail.color === 'object' && !detail.color.name);

      if (isObjectId) {
        try {
          const colorId = mongoose.Types.ObjectId.isValid(detail.color)
            ? detail.color
            : new mongoose.Types.ObjectId(detail.color);
          const color = await Color.findById(colorId);

          if (color) {
            const colorNameToUse = originalColorName || color.name;
            const pantoneToUse = originalPantoneName ?? color.pantoneName ?? undefined;
            detail.color = {
              _id: color._id,
              name: colorNameToUse,
              colorCode: color.colorCode,
              pantoneName: pantoneToUse,
              status: color.status,
            };
          } else {
            detail.color = {
              _id: colorId,
              name: originalColorName || 'Unknown',
              colorCode: '#000000',
              pantoneName: originalPantoneName || undefined,
              status: 'deleted',
            };
          }
        } catch (error) {
          console.error('Error converting color to embedded object:', error);
          detail.color = {
            _id: mongoose.Types.ObjectId.isValid(detail.color) ? detail.color : new mongoose.Types.ObjectId(detail.color),
            name: originalColorName || 'Unknown',
            colorCode: '#000000',
            pantoneName: originalPantoneName || undefined,
            status: 'deleted',
          };
        }
      } else if (detail.color && typeof detail.color === 'object') {
        if (originalColorName) detail.color.name = originalColorName;
        if (originalPantoneName !== null) detail.color.pantoneName = originalPantoneName;
      }
    }
    
    // Convert yarnsubtype ID to embedded object (from YarnType details)
    if (detail.yarnsubtype && detail.yarnType) {
      const isObjectId = mongoose.Types.ObjectId.isValid(detail.yarnsubtype) || 
                        (typeof detail.yarnsubtype === 'string' && mongoose.Types.ObjectId.isValid(detail.yarnsubtype)) ||
                        (detail.yarnsubtype && typeof detail.yarnsubtype === 'object' && !detail.yarnsubtype.subtype);
      
      if (isObjectId) {
        try {
          const yarnTypeId = detail.yarnType._id || detail.yarnType;
          const yarnType = await YarnType.findById(yarnTypeId);
          
          if (yarnType && yarnType.details) {
            const subtypeId = mongoose.Types.ObjectId.isValid(detail.yarnsubtype) 
              ? detail.yarnsubtype 
              : new mongoose.Types.ObjectId(detail.yarnsubtype);
            
            const subtypeDetail = yarnType.details.find(d => d._id.toString() === subtypeId.toString());
            
            if (subtypeDetail) {
              detail.yarnsubtype = {
                _id: subtypeDetail._id,
                subtype: subtypeDetail.subtype,
                countSize: subtypeDetail.countSize || [],
              };
            } else {
              detail.yarnsubtype = {
                _id: subtypeId,
                subtype: 'Unknown',
                countSize: [],
              };
            }
          }
        } catch (error) {
          console.error('Error converting yarnsubtype to embedded object:', error);
        }
      }
    }
  }
};

/**
 * Convert yarnDetails IDs to embedded objects with skipping invalid yarn names
 * This version is used for bulk import to skip yarn names not found in catalog
 * @param {Array} yarnDetails - Supplier yarnDetails array
 * @returns {Promise<Object>} - Object with processedYarnDetails and skippedYarnNames
 */
const convertYarnDetailsToEmbeddedWithSkip = async (yarnDetails) => {
  if (!yarnDetails || !Array.isArray(yarnDetails)) {
    return { processedYarnDetails: [], skippedYarnNames: [] };
  }
  
  const processedYarnDetails = [];
  const skippedYarnNames = [];
  
  for (const detail of yarnDetails) {
    // Preserve original yarnName if provided (don't overwrite it)
    const originalYarnName = detail.yarnName ? String(detail.yarnName).trim() : null;

    // Skip if none of yarnName, yarnType, yarnCatalogId provided
    if (!detail.yarnName && !detail.yarnType && !detail.yarnCatalogId) {
      continue;
    }

    // If yarnCatalogId is provided, fetch catalog and populate from it
    if (detail.yarnCatalogId) {
      try {
        const catalogId = mongoose.Types.ObjectId.isValid(detail.yarnCatalogId)
          ? detail.yarnCatalogId
          : new mongoose.Types.ObjectId(detail.yarnCatalogId);
        const catalog = await YarnCatalog.findById(catalogId);
        if (catalog) {
          const processedDetail = { ...detail };
          processedDetail.yarnCatalogId = catalog._id;
          if (!processedDetail.yarnName) processedDetail.yarnName = catalog.yarnName;
          if (!processedDetail.yarnType && catalog.yarnType) {
            processedDetail.yarnType = {
              _id: catalog.yarnType._id,
              name: catalog.yarnType.name,
              status: catalog.yarnType.status,
            };
          }
          if (!processedDetail.yarnsubtype && catalog.yarnSubtype) {
            processedDetail.yarnsubtype = {
              _id: catalog.yarnSubtype._id,
              subtype: catalog.yarnSubtype.subtype,
              countSize: catalog.yarnSubtype.countSize || [],
            };
          }
          if (originalYarnName) processedDetail.yarnName = originalYarnName;
          // Convert color ID to embedded object if needed
          if (processedDetail.color) {
            const origColorName = (processedDetail.color && typeof processedDetail.color === 'object' && processedDetail.color.name)
              ? String(processedDetail.color.name).trim() : null;
            const isColorId = mongoose.Types.ObjectId.isValid(processedDetail.color) ||
              (typeof processedDetail.color === 'string' && mongoose.Types.ObjectId.isValid(processedDetail.color)) ||
              (processedDetail.color && typeof processedDetail.color === 'object' && !processedDetail.color.name);
            if (isColorId) {
              try {
                const colorId = mongoose.Types.ObjectId.isValid(processedDetail.color)
                  ? processedDetail.color : new mongoose.Types.ObjectId(processedDetail.color);
                const color = await Color.findById(colorId);
                if (color) {
                  processedDetail.color = {
                    _id: color._id,
                    name: origColorName || color.name,
                    colorCode: color.colorCode,
                    status: color.status,
                  };
                } else {
                  processedDetail.color = {
                    _id: colorId,
                    name: origColorName || 'Unknown',
                    colorCode: '#000000',
                    status: 'deleted',
                  };
                }
              } catch (err) {
                console.error('Error converting color to embedded object:', err);
              }
            } else if (origColorName && processedDetail.color && typeof processedDetail.color === 'object') {
              processedDetail.color.name = origColorName;
            }
          }
          processedYarnDetails.push(processedDetail);
        }
      } catch (error) {
        console.error('Error fetching yarn catalog by yarnCatalogId:', error);
      }
      continue;
    }

    // If yarnName is provided, fetch yarnType and yarnSubtype from catalog
    if (detail.yarnName && (!detail.yarnType || !detail.yarnsubtype)) {
      try {
        const catalog = await YarnCatalog.findOne({
          yarnName: detail.yarnName.trim(),
          status: { $ne: 'deleted' },
        });

        if (catalog) {
          // Create a copy of detail to avoid mutating original
          const processedDetail = { ...detail };
          processedDetail.yarnCatalogId = catalog._id;
          // Populate yarnType from catalog if not already provided
          if (!processedDetail.yarnType && catalog.yarnType) {
            processedDetail.yarnType = {
              _id: catalog.yarnType._id,
              name: catalog.yarnType.name,
              status: catalog.yarnType.status,
            };
          }
          // Populate yarnSubtype from catalog if not already provided
          if (!processedDetail.yarnsubtype && catalog.yarnSubtype) {
            processedDetail.yarnsubtype = {
              _id: catalog.yarnSubtype._id,
              subtype: catalog.yarnSubtype.subtype,
              countSize: catalog.yarnSubtype.countSize || [],
            };
          }
          // Restore original yarnName to preserve it exactly as provided (no modifications)
          if (originalYarnName) {
            processedDetail.yarnName = originalYarnName;
          }
          // Convert yarnType ID to embedded object if needed
          if (processedDetail.yarnType) {
            const isObjectId = mongoose.Types.ObjectId.isValid(processedDetail.yarnType) || 
                              (typeof processedDetail.yarnType === 'string' && mongoose.Types.ObjectId.isValid(processedDetail.yarnType)) ||
                              (processedDetail.yarnType && typeof processedDetail.yarnType === 'object' && !processedDetail.yarnType.name);
            
            if (isObjectId) {
              try {
                const yarnTypeId = mongoose.Types.ObjectId.isValid(processedDetail.yarnType) 
                  ? processedDetail.yarnType 
                  : new mongoose.Types.ObjectId(processedDetail.yarnType);
                const yarnType = await YarnType.findById(yarnTypeId);
                
                if (yarnType) {
                  processedDetail.yarnType = {
                    _id: yarnType._id,
                    name: yarnType.name,
                    status: yarnType.status,
                  };
                } else {
                  processedDetail.yarnType = {
                    _id: yarnTypeId,
                    name: 'Unknown',
                    status: 'deleted',
                  };
                }
              } catch (error) {
                console.error('Error converting yarnType to embedded object:', error);
              }
            }
          }
          
          // Convert color ID to embedded object if needed; preserve colorName/pantoneName from request
          if (processedDetail.color) {
            const originalColorName =
              (processedDetail.colorName && String(processedDetail.colorName).trim()) ||
              (processedDetail.color && typeof processedDetail.color === 'object' && processedDetail.color.name && String(processedDetail.color.name).trim()) ||
              null;
            const originalPantoneName =
              (processedDetail.pantoneName != null && processedDetail.pantoneName !== '' && String(processedDetail.pantoneName).trim()) ||
              (processedDetail.color && typeof processedDetail.color === 'object' && processedDetail.pantoneName != null && String(processedDetail.pantoneName).trim()) ||
              null;

            const isObjectId = mongoose.Types.ObjectId.isValid(processedDetail.color) ||
                              (typeof processedDetail.color === 'string' && mongoose.Types.ObjectId.isValid(processedDetail.color)) ||
                              (processedDetail.color && typeof processedDetail.color === 'object' && !processedDetail.color.name);

            if (isObjectId) {
              try {
                const colorId = mongoose.Types.ObjectId.isValid(processedDetail.color)
                  ? processedDetail.color
                  : new mongoose.Types.ObjectId(processedDetail.color);
                const color = await Color.findById(colorId);

                if (color) {
                  const colorNameToUse = originalColorName || color.name;
                  const pantoneToUse = originalPantoneName ?? color.pantoneName ?? undefined;
                  processedDetail.color = {
                    _id: color._id,
                    name: colorNameToUse,
                    colorCode: color.colorCode,
                    pantoneName: pantoneToUse,
                    status: color.status,
                  };
                } else {
                  processedDetail.color = {
                    _id: colorId,
                    name: originalColorName || 'Unknown',
                    colorCode: '#000000',
                    pantoneName: originalPantoneName || undefined,
                    status: 'deleted',
                  };
                }
              } catch (error) {
                console.error('Error converting color to embedded object:', error);
                processedDetail.color = {
                  _id: mongoose.Types.ObjectId.isValid(processedDetail.color) ? processedDetail.color : new mongoose.Types.ObjectId(processedDetail.color),
                  name: originalColorName || 'Unknown',
                  colorCode: '#000000',
                  pantoneName: originalPantoneName || undefined,
                  status: 'deleted',
                };
              }
            } else if (processedDetail.color && typeof processedDetail.color === 'object') {
              if (originalColorName) processedDetail.color.name = originalColorName;
              if (originalPantoneName !== null) processedDetail.color.pantoneName = originalPantoneName;
            }
          }

          // Convert yarnsubtype ID to embedded object if needed
          if (processedDetail.yarnsubtype && processedDetail.yarnType) {
            const isObjectId = mongoose.Types.ObjectId.isValid(processedDetail.yarnsubtype) || 
                              (typeof processedDetail.yarnsubtype === 'string' && mongoose.Types.ObjectId.isValid(processedDetail.yarnsubtype)) ||
                              (processedDetail.yarnsubtype && typeof processedDetail.yarnsubtype === 'object' && !processedDetail.yarnsubtype.subtype);
            
            if (isObjectId) {
              try {
                const yarnTypeId = processedDetail.yarnType._id || processedDetail.yarnType;
                const yarnType = await YarnType.findById(yarnTypeId);
                
                if (yarnType && yarnType.details) {
                  const subtypeId = mongoose.Types.ObjectId.isValid(processedDetail.yarnsubtype) 
                    ? processedDetail.yarnsubtype 
                    : new mongoose.Types.ObjectId(processedDetail.yarnsubtype);
                  
                  const subtypeDetail = yarnType.details.find(d => d._id.toString() === subtypeId.toString());
                  
                  if (subtypeDetail) {
                    processedDetail.yarnsubtype = {
                      _id: subtypeDetail._id,
                      subtype: subtypeDetail.subtype,
                      countSize: subtypeDetail.countSize || [],
                    };
                  } else {
                    processedDetail.yarnsubtype = {
                      _id: subtypeId,
                      subtype: 'Unknown',
                      countSize: [],
                    };
                  }
                }
              } catch (error) {
                console.error('Error converting yarnsubtype to embedded object:', error);
              }
            }
          }
          
          // Add to processed details if catalog found
          processedYarnDetails.push(processedDetail);
        } else {
          // Skip this yarn name and add to skipped list
          skippedYarnNames.push(detail.yarnName.trim());
        }
      } catch (error) {
        console.error('Error fetching yarn catalog by yarnName:', error);
        // Skip this yarn name on error
        skippedYarnNames.push(detail.yarnName.trim());
      }
    } else {
      // If yarnType is provided directly, process it normally
      const processedDetail = { ...detail };
      
      // Convert yarnType ID to embedded object if needed
      if (processedDetail.yarnType) {
        const isObjectId = mongoose.Types.ObjectId.isValid(processedDetail.yarnType) || 
                          (typeof processedDetail.yarnType === 'string' && mongoose.Types.ObjectId.isValid(processedDetail.yarnType)) ||
                          (processedDetail.yarnType && typeof processedDetail.yarnType === 'object' && !processedDetail.yarnType.name);
        
        if (isObjectId) {
          try {
            const yarnTypeId = mongoose.Types.ObjectId.isValid(processedDetail.yarnType) 
              ? processedDetail.yarnType 
              : new mongoose.Types.ObjectId(processedDetail.yarnType);
            const yarnType = await YarnType.findById(yarnTypeId);
            
            if (yarnType) {
              processedDetail.yarnType = {
                _id: yarnType._id,
                name: yarnType.name,
                status: yarnType.status,
              };
            } else {
              processedDetail.yarnType = {
                _id: yarnTypeId,
                name: 'Unknown',
                status: 'deleted',
              };
            }
          } catch (error) {
            console.error('Error converting yarnType to embedded object:', error);
          }
        }
      }
      
      // Convert color ID to embedded object if needed; preserve colorName/pantoneName from request
      if (processedDetail.color) {
        const originalColorName =
          (processedDetail.colorName && String(processedDetail.colorName).trim()) ||
          (processedDetail.color && typeof processedDetail.color === 'object' && processedDetail.color.name && String(processedDetail.color.name).trim()) ||
          null;
        const originalPantoneName =
          (processedDetail.pantoneName != null && processedDetail.pantoneName !== '' && String(processedDetail.pantoneName).trim()) ||
          (processedDetail.color && typeof processedDetail.color === 'object' && processedDetail.pantoneName != null && String(processedDetail.pantoneName).trim()) ||
          null;

        const isObjectId = mongoose.Types.ObjectId.isValid(processedDetail.color) ||
                          (typeof processedDetail.color === 'string' && mongoose.Types.ObjectId.isValid(processedDetail.color)) ||
                          (processedDetail.color && typeof processedDetail.color === 'object' && !processedDetail.color.name);

        if (isObjectId) {
          try {
            const colorId = mongoose.Types.ObjectId.isValid(processedDetail.color)
              ? processedDetail.color
              : new mongoose.Types.ObjectId(processedDetail.color);
            const color = await Color.findById(colorId);

            if (color) {
              const colorNameToUse = originalColorName || color.name;
              const pantoneToUse = originalPantoneName ?? color.pantoneName ?? undefined;
              processedDetail.color = {
                _id: color._id,
                name: colorNameToUse,
                colorCode: color.colorCode,
                pantoneName: pantoneToUse,
                status: color.status,
              };
            } else {
              processedDetail.color = {
                _id: colorId,
                name: originalColorName || 'Unknown',
                colorCode: '#000000',
                pantoneName: originalPantoneName || undefined,
                status: 'deleted',
              };
            }
          } catch (error) {
            console.error('Error converting color to embedded object:', error);
            processedDetail.color = {
              _id: mongoose.Types.ObjectId.isValid(processedDetail.color) ? processedDetail.color : new mongoose.Types.ObjectId(processedDetail.color),
              name: originalColorName || 'Unknown',
              colorCode: '#000000',
              pantoneName: originalPantoneName || undefined,
              status: 'deleted',
            };
          }
        } else if (processedDetail.color && typeof processedDetail.color === 'object') {
          if (originalColorName) processedDetail.color.name = originalColorName;
          if (originalPantoneName !== null) processedDetail.color.pantoneName = originalPantoneName;
        }
      }

      // Convert yarnsubtype ID to embedded object if needed
      if (processedDetail.yarnsubtype && processedDetail.yarnType) {
        const isObjectId = mongoose.Types.ObjectId.isValid(processedDetail.yarnsubtype) || 
                          (typeof processedDetail.yarnsubtype === 'string' && mongoose.Types.ObjectId.isValid(processedDetail.yarnsubtype)) ||
                          (processedDetail.yarnsubtype && typeof processedDetail.yarnsubtype === 'object' && !processedDetail.yarnsubtype.subtype);
        
        if (isObjectId) {
          try {
            const yarnTypeId = processedDetail.yarnType._id || processedDetail.yarnType;
            const yarnType = await YarnType.findById(yarnTypeId);
            
            if (yarnType && yarnType.details) {
              const subtypeId = mongoose.Types.ObjectId.isValid(processedDetail.yarnsubtype) 
                ? processedDetail.yarnsubtype 
                : new mongoose.Types.ObjectId(processedDetail.yarnsubtype);
              
              const subtypeDetail = yarnType.details.find(d => d._id.toString() === subtypeId.toString());
              
              if (subtypeDetail) {
                processedDetail.yarnsubtype = {
                  _id: subtypeDetail._id,
                  subtype: subtypeDetail.subtype,
                  countSize: subtypeDetail.countSize || [],
                };
              } else {
                processedDetail.yarnsubtype = {
                  _id: subtypeId,
                  subtype: 'Unknown',
                  countSize: [],
                };
              }
            }
          } catch (error) {
            console.error('Error converting yarnsubtype to embedded object:', error);
          }
        }
      }
      
      processedYarnDetails.push(processedDetail);
    }
  }
  
  return { processedYarnDetails, skippedYarnNames };
};

/**
 * Validate yarnsubtype exists in the YarnType's details array
 * @param {ObjectId} yarnTypeId - The YarnType ID
 * @param {ObjectId} yarnsubtypeId - The detail item ID
 * @returns {Promise<boolean>}
 */
const validateYarnSubtype = async (yarnTypeId, yarnsubtypeId) => {
  if (!yarnsubtypeId) return true; // Optional field
  
  const yarnType = await YarnType.findById(yarnTypeId);
  if (!yarnType) return false;
  
  // Check if the detail ID exists in the details array
  return yarnType.details.some(detail => detail._id.toString() === yarnsubtypeId.toString());
};

/**
 * Create a supplier
 * @param {Object} supplierBody
 * @returns {Promise<Supplier>}
 */
export const createSupplier = async (supplierBody) => {
  if (await Supplier.isEmailTaken(supplierBody.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (supplierBody.gstNo && (await Supplier.isGstNoTaken(supplierBody.gstNo))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'GST number already taken');
  }
  
  // Convert IDs to embedded objects BEFORE creating (so Mongoose validation passes)
  if (supplierBody.yarnDetails && Array.isArray(supplierBody.yarnDetails)) {
    await convertYarnDetailsToEmbedded(supplierBody.yarnDetails);
    
    // Validate yarnsubtype if provided (after conversion, we can check the embedded object)
    for (const detail of supplierBody.yarnDetails) {
      if (detail.yarnsubtype && detail.yarnType) {
        // If yarnsubtype is still an ID, validate it exists
        if (mongoose.Types.ObjectId.isValid(detail.yarnsubtype) || typeof detail.yarnsubtype === 'string') {
          const isValid = await validateYarnSubtype(detail.yarnType._id || detail.yarnType, detail.yarnsubtype);
          if (!isValid) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid yarnsubtype - does not exist in YarnType details');
          }
        }
      }
    }
  }
  
  return Supplier.create(supplierBody);
};

/**
 * Query for suppliers
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const querySuppliers = async (filter, options) => {
  // Convert brandName to case-insensitive regex for partial matching
  if (filter.brandName) {
    filter.brandName = { $regex: filter.brandName, $options: 'i' };
  }
  
  // No need to populate - yarnDetails are now embedded objects
  const suppliers = await Supplier.paginate(filter, options);
  return suppliers;
};

/**
 * Get supplier by id
 * @param {ObjectId} id
 * @returns {Promise<Supplier>}
 */
export const getSupplierById = async (id) => {
  // No need to populate - yarnDetails are now embedded objects
  return Supplier.findById(id);
};

/**
 * Get tearweight info for given yarn name(s) for a supplier.
 * @param {ObjectId} supplierId - Supplier ID
 * @param {string[]} yarnNames - Array of yarn names to look up
 * @returns {Promise<{ supplierId: string, yarnTearweights: Array<{ yarnName: string, tearweight: number }>, notFound: string[] }>}
 */
export const getSupplierYarnTearweight = async (supplierId, yarnNames) => {
  const supplier = await Supplier.findById(supplierId).lean();
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }
  const namesSet = new Set((yarnNames || []).map((n) => String(n).trim()).filter(Boolean));
  const yarnTearweights = [];
  const foundNames = new Set();
  for (const detail of supplier.yarnDetails || []) {
    const name = detail.yarnName ? String(detail.yarnName).trim() : '';
    if (name && namesSet.has(name)) {
      yarnTearweights.push({ yarnName: name, tearweight: detail.tearweight });
      foundNames.add(name);
    }
  }
  const notFound = [...namesSet].filter((n) => !foundNames.has(n));
  return {
    supplierId: supplier._id.toString(),
    yarnTearweights,
    notFound,
  };
};

/**
 * Sync all suppliers' yarnDetails with YarnCatalog (same as migrate-supplier-yarn-catalog-id.js script).
 * For each supplier: set yarnCatalogId when missing, update yarnName/yarnType/yarnsubtype from catalog when present.
 * @returns {Promise<{ suppliersUpdated: number, detailsLinked: number, detailsSynced: number, noMatch: number, catalogNotFound: number }>}
 */
export const syncAllSuppliersYarnDetailsWithCatalog = async () => {
  const suppliers = await Supplier.find({ 'yarnDetails.0': { $exists: true } }).lean().exec();
  let suppliersUpdated = 0;
  let detailsLinked = 0;
  let detailsSynced = 0;
  let noMatch = 0;
  let catalogNotFound = 0;

  for (const plain of suppliers) {
    const result = await runSyncForSupplier(plain);
    if (result.detailsLinked > 0 || result.detailsSynced > 0) {
      await Supplier.updateOne(
        { _id: plain._id },
        { $set: { yarnDetails: result.updatedDetails } }
      );
      suppliersUpdated += 1;
    }
    detailsLinked += result.detailsLinked;
    detailsSynced += result.detailsSynced;
    noMatch += result.noMatch;
    catalogNotFound += result.catalogNotFound;
  }

  return {
    suppliersUpdated,
    detailsLinked,
    detailsSynced,
    noMatch,
    catalogNotFound,
  };
};

/**
 * Sync one supplier's yarnDetails with YarnCatalog (by supplierId).
 * @param {ObjectId} supplierId
 * @returns {Promise<{ supplier: Supplier, detailsLinked: number, detailsSynced: number, noMatch: number, catalogNotFound: number }>}
 */
export const syncSupplierYarnDetailsWithCatalog = async (supplierId) => {
  const supplier = await getSupplierById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }
  const plain = supplier.toObject ? supplier.toObject() : supplier;
  const result = await runSyncForSupplier(plain);
  supplier.yarnDetails = result.updatedDetails;
  await supplier.save();
  return {
    supplier,
    detailsLinked: result.detailsLinked,
    detailsSynced: result.detailsSynced,
    noMatch: result.noMatch,
    catalogNotFound: result.catalogNotFound,
  };
};

/**
 * Update supplier by id
 * @param {ObjectId} supplierId
 * @param {Object} updateBody
 * @returns {Promise<Supplier>}
 */
export const updateSupplierById = async (supplierId, updateBody) => {
  const supplier = await getSupplierById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }
  if (updateBody.email && (await Supplier.isEmailTaken(updateBody.email, supplierId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (updateBody.gstNo && (await Supplier.isGstNoTaken(updateBody.gstNo, supplierId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'GST number already taken');
  }
  
  // Convert IDs to embedded objects BEFORE updating (so Mongoose validation passes)
  if (updateBody.yarnDetails && Array.isArray(updateBody.yarnDetails)) {
    await convertYarnDetailsToEmbedded(updateBody.yarnDetails);
    
    // Validate yarnsubtype if provided
    for (const detail of updateBody.yarnDetails) {
      if (detail.yarnsubtype && detail.yarnType) {
        // If yarnsubtype is still an ID, validate it exists
        if (mongoose.Types.ObjectId.isValid(detail.yarnsubtype) || typeof detail.yarnsubtype === 'string') {
          const isValid = await validateYarnSubtype(detail.yarnType._id || detail.yarnType, detail.yarnsubtype);
          if (!isValid) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid yarnsubtype - does not exist in YarnType details');
          }
        }
      }
    }
  }
  
  Object.assign(supplier, updateBody);
  await supplier.save();
  return supplier;
};

/**
 * Delete supplier by id
 * @param {ObjectId} supplierId
 * @returns {Promise<Supplier>}
 */
export const deleteSupplierById = async (supplierId) => {
  const supplier = await getSupplierById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }
  await supplier.deleteOne();
  return supplier;
};

/**
 * Bulk import suppliers with batch processing
 * @param {Array} suppliers - Array of supplier objects
 * @param {number} batchSize - Number of suppliers to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportSuppliers = async (suppliers, batchSize = 50) => {
  const results = {
    total: suppliers.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    skippedYarnNames: [], // Array of objects with supplier info and skipped yarn names
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (suppliers.length > 1000) {
      throw new Error('Maximum 1000 suppliers allowed per request');
    }

    // Process suppliers in batches
    for (let i = 0; i < suppliers.length; i += batchSize) {
      const batch = suppliers.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        const batchPromises = batch.map(async (supplierData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = supplierData.id && supplierData.id.trim() !== '';
            
            // Validate required fields
            const requiredFields = ['brandName', 'contactPersonName', 'contactNumber', 'email', 'address', 'city', 'state', 'pincode', 'country'];
            const missingFields = requiredFields.filter(field => !supplierData[field] || supplierData[field].toString().trim() === '');
            
            if (missingFields.length > 0) {
              throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
            }

            // Validate formats
            if (!/^\+?[\d\s\-\(\)]{10,15}$/.test(supplierData.contactNumber.trim())) {
              throw new Error('Invalid contact number format');
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierData.email.trim())) {
              throw new Error('Invalid email format');
            }
            if (!/^[0-9]{6}$/.test(supplierData.pincode.trim())) {
              throw new Error('Invalid pincode format. Must be 6 digits');
            }
            if (supplierData.gstNo && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(supplierData.gstNo.trim())) {
              throw new Error('Invalid GST number format');
            }

            const processedData = {
              brandName: supplierData.brandName.trim(),
              contactPersonName: supplierData.contactPersonName.trim(),
              contactNumber: supplierData.contactNumber.trim(),
              email: supplierData.email.trim().toLowerCase(),
              address: supplierData.address.trim(),
              city: supplierData.city.trim(),
              state: supplierData.state.trim(),
              pincode: supplierData.pincode.trim(),
              country: supplierData.country.trim(),
              gstNo: supplierData.gstNo ? supplierData.gstNo.trim().toUpperCase() : undefined,
              yarnDetails: supplierData.yarnDetails || [],
              status: supplierData.status || 'active',
            };

            // Convert yarnDetails IDs to embedded objects if provided (with skipping invalid yarn names)
            if (processedData.yarnDetails && Array.isArray(processedData.yarnDetails)) {
              const { processedYarnDetails, skippedYarnNames } = await convertYarnDetailsToEmbeddedWithSkip(processedData.yarnDetails);
              
              // Track skipped yarn names for this supplier
              if (skippedYarnNames.length > 0) {
                results.skippedYarnNames.push({
                  index: globalIndex,
                  brandName: processedData.brandName,
                  email: processedData.email,
                  skippedYarnNames: skippedYarnNames,
                });
              }
              
              // Update processedData with filtered yarnDetails
              processedData.yarnDetails = processedYarnDetails;
              
              // Validate yarnsubtype if provided
              for (const detail of processedData.yarnDetails) {
                if (detail.yarnsubtype && detail.yarnType) {
                  if (mongoose.Types.ObjectId.isValid(detail.yarnsubtype) || typeof detail.yarnsubtype === 'string') {
                    const isValid = await validateYarnSubtype(detail.yarnType._id || detail.yarnType, detail.yarnsubtype);
                    if (!isValid) {
                      throw new Error('Invalid yarnsubtype - does not exist in YarnType details');
                    }
                  }
                }
              }
            }

            if (hasId) {
              // Validate ObjectId format
              if (!/^[0-9a-fA-F]{24}$/.test(supplierData.id.trim())) {
                throw new Error('Invalid supplier ID format');
              }

              const existingSupplier = await Supplier.findById(supplierData.id).lean();
              if (!existingSupplier) {
                throw new Error(`Supplier with ID ${supplierData.id} not found`);
              }
              
              // Check for email conflicts
              if (processedData.email !== existingSupplier.email) {
                if (await Supplier.isEmailTaken(processedData.email, supplierData.id)) {
                  throw new Error(`Email "${processedData.email}" already taken`);
                }
              }
              
              // Check for GST number conflicts
              if (processedData.gstNo && processedData.gstNo !== existingSupplier.gstNo) {
                if (await Supplier.isGstNoTaken(processedData.gstNo, supplierData.id)) {
                  throw new Error(`GST number "${processedData.gstNo}" already taken`);
                }
              }
              
              await Supplier.updateOne(
                { _id: supplierData.id },
                { $set: processedData }
              );
              results.updated++;
            } else {
              // Check for email conflicts
              if (await Supplier.isEmailTaken(processedData.email)) {
                throw new Error(`Email "${processedData.email}" already taken`);
              }
              
              // Check for GST number conflicts
              if (processedData.gstNo && await Supplier.isGstNoTaken(processedData.gstNo)) {
                throw new Error(`GST number "${processedData.gstNo}" already taken`);
              }
              
              await Supplier.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              brandName: supplierData.brandName || 'N/A',
              email: supplierData.email || 'N/A',
              error: error.message,
            });
          }
        });
        
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        console.log(`Supplier batch ${Math.floor(i / batchSize) + 1} completed in ${batchEndTime - batchStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing supplier batch ${Math.floor(i / batchSize) + 1}:`, error);
        batch.forEach((supplierData, batchIndex) => {
          const globalIndex = i + batchIndex;
          results.failed++;
          results.errors.push({
            index: globalIndex,
            brandName: supplierData.brandName || 'N/A',
            email: supplierData.email || 'N/A',
            error: `Batch processing error: ${error.message}`,
          });
        });
      }
    }
    
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    
    console.log(`Bulk import suppliers completed in ${results.processingTime}ms: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);
    
    return results;
    
  } catch (error) {
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    results.errors.push({
      index: -1,
      brandName: 'N/A',
      email: 'N/A',
      error: `Bulk import failed: ${error.message}`,
    });
    throw error;
  }
};

