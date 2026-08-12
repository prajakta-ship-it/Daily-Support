/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @description Substitutes Shopify sales order line items based on
 *              customrecord_scm_item_substitute records.
 *
 * NOTE ON DESIGN:
 * This runs on beforeSubmit (not afterSubmit) and edits context.newRecord
 * directly. NetSuite persists context.newRecord automatically once
 * beforeSubmit completes, so there is no manual record.load()/save().
 * Doing load()+save() inside afterSubmit (as in the original script)
 * re-triggers this same User Event script on every save, which is an
 * infinite-recursion / governance risk. beforeSubmit avoids that entirely.
 */
define(['N/search', 'N/log'], function (search, log) {

    var FIELD_ETAIL_CHANNEL = 'custbody_celigo_etail_channel';
    var FIELD_INTERNAL_STATUS = 'custbody_internalstatus';
    var STATUS_PENDING_SUBSTITUTION = 8;

    var COL_ITEM = 'item';
    var COL_ORIGINAL_ITEM = 'custcol_scm_itemsub_original_item';
    var COL_COMMERCIAL_PRICE = 'custcol_commercial_price';
    var COL_RATE = 'rate';
    var COL_DEPARTMENT = 'department';
    var COL_COMMIT_INVENTORY = 'commitinventory';

    var SUBSTITUTE_RECORD_TYPE = 'customrecord_scm_item_substitute';

    /**
     * @param {Object} context
     */
    function beforeSubmit(context) {

        try {
            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT &&
                context.type !== context.UserEventType.COPY
            ) {
                return;
            }

            var salesOrder = context.newRecord;

            var isShopifyOrder = salesOrder.getValue({ fieldId: FIELD_ETAIL_CHANNEL });
            log.debug('isShopifyOrder', isShopifyOrder);

            if (!isShopifyOrder) {
                log.audit('Shopify channel not selected', 'Skipping substitution logic');
                return;
            }

            var substituteMap = getItemSubstituteMap();
            var lineCount = salesOrder.getLineCount({ sublistId: COL_ITEM });
            var hasPendingSubstitution = false;

            for (var i = 0; i < lineCount; i++) {

                var itemId = salesOrder.getSublistValue({
                    sublistId: COL_ITEM,
                    fieldId: 'item',
                    line: i
                });

                if (!itemId) {
                    continue;
                }

                var itemDetails = substituteMap[itemId];

                // No active substitute defined for this item: flag the order
                // for manual review and move on to the next line.
                if (!itemDetails) {
                    log.debug('Pending substitution', 'No substitute found for item ' + itemId);
                    hasPendingSubstitution = true;
                    continue;
                }

                if (itemDetails.substituteItem) {
                    salesOrder.setSublistValue({
                        sublistId: COL_ITEM,
                        fieldId: COL_ORIGINAL_ITEM,
                        line: i,
                        value: itemDetails.substituteItem
                    });
                }

                if (itemDetails.basePrice) {
                    salesOrder.setSublistValue({
                        sublistId: COL_ITEM,
                        fieldId: COL_COMMERCIAL_PRICE,
                        line: i,
                        value: itemDetails.basePrice
                    });
                }

                if (itemDetails.shippingRate) {
                    salesOrder.setSublistValue({
                        sublistId: COL_ITEM,
                        fieldId: COL_RATE,
                        line: i,
                        value: itemDetails.shippingRate
                    });
                }

                if (itemDetails.department) {
                    salesOrder.setSublistValue({
                        sublistId: COL_ITEM,
                        fieldId: COL_DEPARTMENT,
                        line: i,
                        value: itemDetails.department
                    });
                }

                salesOrder.setSublistValue({
                    sublistId: COL_ITEM,
                    fieldId: COL_COMMIT_INVENTORY,
                    line: i,
                    value: true
                });

                log.audit('Item replaced', {
                    line: i,
                    oldItem: itemId,
                    newItem: itemDetails.substituteItem
                });
            }

            if (hasPendingSubstitution) {
                salesOrder.setValue({
                    fieldId: FIELD_INTERNAL_STATUS,
                    value: STATUS_PENDING_SUBSTITUTION
                });
            }

        } catch (e) {
            log.error({
                title: 'beforeSubmit Error',
                details: e
            });
            // Re-throw so the platform surfaces the failure rather than
            // silently saving a half-processed order.
            throw e;
        }
    }

    /**
     * Builds a map of active item substitutes, keyed by the parent
     * (original) item's internal ID, e.g. { "123": { substituteItem, ... } }
     *
     * @returns {Object.<string, Object>}
     */
    function getItemSubstituteMap() {

        var substituteMap = {};

        var substituteSearch = search.create({
            type: SUBSTITUTE_RECORD_TYPE,
            filters: [
                ['isinactive', 'is', 'F']
            ],
            columns: [
                search.createColumn({ name: 'internalid', join: 'CUSTRECORD_SCM_ITEMSUB_PARENT' }),
                'custrecord_scm_itemsub_parent',
                'custrecord_scm_itemsub_substitute',
                'custrecord_scm_itemsub_description',
                search.createColumn({ name: 'internalid', join: 'CUSTRECORD_SCM_ITEMSUB_SUBSTITUTE' }),
                search.createColumn({ name: 'department', join: 'CUSTRECORD_SCM_ITEMSUB_SUBSTITUTE' }),
                search.createColumn({ name: 'baseprice', join: 'CUSTRECORD_SCM_ITEMSUB_SUBSTITUTE' }),
                search.createColumn({ name: 'shippingrate', join: 'CUSTRECORD_SCM_ITEMSUB_SUBSTITUTE' })
            ]
        });

        var pagedData = substituteSearch.runPaged({ pageSize: 1000 });
        log.debug('Total substitute results', pagedData.count);

        pagedData.pageRanges.forEach(function (pageRange) {

            var page = pagedData.fetch({ index: pageRange.index });

            page.data.forEach(function (result) {

                var parentItemId = result.getValue({
                    name: 'internalid',
                    join: 'CUSTRECORD_SCM_ITEMSUB_PARENT'
                });

                if (!parentItemId) {
                    return;
                }

                substituteMap[parentItemId] = {
                    parentItem: result.getValue('custrecord_scm_itemsub_parent'),
                    substituteItem: result.getValue('custrecord_scm_itemsub_substitute'),
                    description: result.getValue('custrecord_scm_itemsub_description'),
                    substituteItemId: result.getValue({
                        name: 'internalid',
                        join: 'CUSTRECORD_SCM_ITEMSUB_SUBSTITUTE'
                    }),
                    department: result.getValue({
                        name: 'department',
                        join: 'CUSTRECORD_SCM_ITEMSUB_SUBSTITUTE'
                    }),
                    basePrice: result.getValue({
                        name: 'baseprice',
                        join: 'CUSTRECORD_SCM_ITEMSUB_SUBSTITUTE'
                    }),
                    shippingRate: result.getValue({
                        name: 'shippingrate',
                        join: 'CUSTRECORD_SCM_ITEMSUB_SUBSTITUTE'
                    })
                };
            });
        });

        log.debug('substituteMap size', Object.keys(substituteMap).length);

        return substituteMap;
    }

    return {
        beforeSubmit: beforeSubmit
    };

});