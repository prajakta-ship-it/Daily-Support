/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Script Name : IEK - Inventory Count - Combined QOH Display (General + Shopify Virtual)
 * Record Type : Inventory Count (invcount)
 * Approach    : Option A - Combined QOH Display Only (per approved solution doc)
 *
 * Confirmed field/sublist IDs (from XML dump of the record):
 *   
 */

define(['N/record', 'N/search', 'N/log'], function (record, search, log) {

    var GENERAL_LOCATION_ID = 3;         
    var SHOPIFY_VIRTUAL_LOCATION_ID = 1; 
    var SUBLIST_ID = 'item';
    var QOH_FIELD_ID = 'snapshotline'; 

    function getCombinedQty(itemId) {
        var qohGeneral = getOnHandQty(itemId, GENERAL_LOCATION_ID);
        var qohShopify = getOnHandQty(itemId, SHOPIFY_VIRTUAL_LOCATION_ID);
        log.debug({
            title: 'Combined QOH Calculation',
            details: 'Item ' + itemId + ': General QOH = ' + qohGeneral + ', Shopify QOH = ' + qohShopify
        });
        return qohGeneral + qohShopify;
    }
    function beforeSubmit(context) {
        try {
            var newRec = context.newRecord;
            var headerLocation = newRec.getValue({ fieldId: 'location' });
            log.debug({ title: 'Header Location', details: headerLocation });
            if (parseInt(headerLocation, 10) !== GENERAL_LOCATION_ID) {
                return;
            }
            var lineCount = newRec.getLineCount({ sublistId: SUBLIST_ID });
            var checbox_inventory =newRec.getValue({fieldId:'custbody_inventory_count'})
            log.debug({ title: 'Inventory Count Checkbox', details: checbox_inventory });
            if(checbox_inventory == true){
                log.debug('checkbox is checked');
                for (var i = 0; i < lineCount; i++) {
                    var itemId = newRec.getSublistValue({
                        sublistId: SUBLIST_ID,
                        fieldId: 'item',
                        line: i
                    });
                    log.debug({ title: 'Line ' + i, details: 'itemId=' + itemId });
                    if (!itemId) continue;
                    var combinedQty = getCombinedQty(itemId);
                    if(combinedQty){
                        newRec.setSublistValue({
                        sublistId: SUBLIST_ID,
                        fieldId: 'snapshotquantity',
                        line: i,
                        value: combinedQty
                    });
                    }
                    
                }
            }else
            {

                // log.debug('checkbox is unchecked');
                log.debug('checkbox is unchecked');
            }
        } catch (e) {
            log.error({ title: 'Error in Combined QOH Display script', details: e });
        }
    }
     function getOnHandQty(itemId, locationId) {
        log.debug('getOnHandQty', 'itemId=' + itemId + ' locationId=' + locationId);
            if (!itemId || !locationId) return 0;
    
            var qty = 0;
            var results = search.create({
                type: 'item',
                filters: [
                    ['inventorylocation', 'anyof', locationId],
                    'AND',
                    ['internalid', 'anyof', itemId]
                ],
                columns: [
                    search.createColumn({ name: 'locationquantityonhand', label: 'Location On Hand' })
                ]
            }).run().getRange({ start: 0, end: 1 });
    
            if (results && results.length > 0) {
                var val = results[0].getValue('locationquantityonhand');
                log.debug('getOnHandQty result', 'itemId=' + itemId + ' locationId=' + locationId + ' val=' + val);
                qty = val ? parseFloat(val) : 0;
            } else {
                log.debug('getOnHandQty result', 'no rows for itemId=' + itemId + ' locationId=' + locationId);
            }
            return qty;
        }

    return {
        beforeSubmit: beforeSubmit
    };
});