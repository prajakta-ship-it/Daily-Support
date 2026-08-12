/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/log', 'N/record', 'N/search', 'N/runtime', 'N/error'],
    function (log, record, search, runtime, error) {

        function getInputData() {
            log.debug("search");
            var savedSearch = search.load({
                id: 'customsearch_inv_transfer_3'

            });

            return savedSearch;
        }

        function map(context) {
            var searchResult = JSON.parse(context.value);

            var itemId = searchResult.id;
            log.debug("itemId", itemId);

            var fromLocation = '3'; // General Stock location
            var toLocation = '1'; // 90 Shopify Virtual Inventory

            var transferQty = Math.abs(searchResult.values['formulanumeric']);
            log.debug("transferQty (absolute value)", transferQty);

            var availableQty = getAvailableQty(itemId, fromLocation);

            log.debug("Available Quantity at General Stock", availableQty);

            // Check if there is enough quantity at the General Stock location
            if (availableQty < transferQty) {
                log.error({
                    title: 'Insufficient Quantity for Transfer',
                    details: 'Item ID: ' + itemId + ' - Available Quantity: ' + availableQty + ', Requested Transfer Quantity: ' + transferQty
                });

                // Skip this record if insufficient quantity
                return;
            }

            var transferData = {
                itemId: itemId,
                fromLocation: fromLocation,
                toLocation: toLocation,
                transferQty: transferQty
            };

            context.write({
                key: itemId + "_" + fromLocation + "_" + toLocation + "_" + transferQty,
                value: transferData
            });
        }

        function reduce(context) {
          log.debug("context",context)
            var transferData = JSON.parse(context.values[0]);
log.debug("transferData",transferData)
            var itemId = transferData.itemId;
            var fromLocation = transferData.fromLocation;
            var toLocation = transferData.toLocation;
            var transferQty = transferData.transferQty;
log.debug("itemId",itemId,fromLocation,toLocation,transferQty)
            try {
                createInventoryTransfer(itemId, fromLocation, toLocation, transferQty);
            } catch (e) {
                log.error({
                    title: 'Error Creating Inventory Transfer',
                    details: e.toString()
                });
            }
        }

        function summarize(summary) {

            const scriptObj = runtime.getCurrentScript();

                //i want to reschedule the script in after 3 minutes
            
                        const mrTask = task.create({

                            taskType: task.TaskType.MAP_REDUCE,

                            scriptId: scriptObj.id,

                            // deploymentId: scriptObj.deploymentId,
                        });

            const taskId = mrTask.submit();
            log.audit('Map/Reduce Rescheduled', taskId);
        }
        // Helper function to check available quantity at a location
        function getAvailableQty(itemId, locationId) {
            log.debug("inside getAvailableQty")
            var inventorySearch = search.create({
                type: "item",
                filters:
                [
                   ["inventorylocation","anyof",locationId], 
                   "AND", 
                   ["internalid","anyof",itemId]
                ],
                columns:
                [
                   search.createColumn({name: "locationquantityonhand", label: "Location On Hand"})
                ]
             });

            var resultSet = inventorySearch.run();
            var availableQty = 0;

            resultSet.each(function (result) {
                availableQty = parseFloat(result.getValue('locationquantityonhand')) || 0;
                return true;
            });
            log.debug("inside availableQty val",availableQty)

            return availableQty;
        }

        // Separate function to create an inventory transfer
        function createInventoryTransfer(itemId, fromLocation, toLocation, transferQty) {
            var inventoryTransfer = record.create({
                type: record.Type.INVENTORY_TRANSFER,
                isDynamic: true
            });

            inventoryTransfer.setValue({
                fieldId: 'subsidiary',
                value: 1
            });

            inventoryTransfer.setValue({
                fieldId: 'location',
                value: fromLocation
            });

            inventoryTransfer.setValue({
                fieldId: 'transferlocation',
                value: toLocation
            });

            inventoryTransfer.selectNewLine({
                sublistId: 'inventory',
            });

            inventoryTransfer.setCurrentSublistValue({
                sublistId: 'inventory',
                fieldId: 'item',
                value: itemId
            });

            inventoryTransfer.setCurrentSublistValue({
                sublistId: 'inventory',
                fieldId: 'adjustqtyby',
                value: transferQty
            });

            inventoryTransfer.commitLine({
                sublistId: 'inventory'
            });

            var transferId = inventoryTransfer.save();

            log.debug({
                title: 'Inventory Transfer Created',
                details: 'Created Inventory Transfer for Item ID: ' + itemId + ', From: ' + fromLocation + ', To: ' + toLocation + ', Quantity: ' + transferQty + ', Transfer ID: ' + transferId
            });
        }

        return {
            getInputData: getInputData,
            map: map,
            reduce: reduce,
            summarize: summarize
        };
    });