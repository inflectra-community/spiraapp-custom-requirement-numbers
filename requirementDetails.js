// =============================================================================
// Custom Requirements Numbering - Requirement Details page (pageId 9)
// Copyright Inmarsys Limited
// =============================================================================
// This is the ONLY script in this SpiraApp. There is deliberately no admin
// page script (no pageId 21 entry in the manifest) - every configurable
// setting is a native productSetting, so Spira renders, saves, and
// persists all of them with zero custom code. See Readme.md for why: an
// earlier version rendered its own admin UI with raw DOM access, which
// Inflectra confirmed in writing does not meet their SpiraApp publication
// standards. This version has no DOM access anywhere, and makes no REST
// API calls either - everything goes through getDataItemField/
// getLiveFormFieldValue/updateFormField and the Storage API.
//
// HISTORY: two earlier designs were tried and abandoned for the
// Type-to-prefix mapping specifically (both are still visible in git/chat
// history if useful context is ever needed):
//   1. An admin-typed Custom List name (plain text setting) - worked, but
//      needed exact-name typing with no dropdown.
//   2. A Custom List wrapped in a List-type Requirement custom property,
//      selected via dropdown and read via getDataItemField(..., "lookups")
//      - worked for reading the data, but hiding that now-unwanted
//      wrapper field from the requirement Overview
//      (updateFormField(fieldName, "hidden", true)) caused severe page
//      hangs, confirmed to be an unreliable mechanism across tabs/saves/
//      navigation, not just a one-off bug.
// This version sidesteps the whole problem: up to 20 Type/Prefix pairs
// are declared directly as native settings (ArtifactTypeSingleSelect +
// Plain Text). No Custom List, no wrapper property, no extra field on the
// requirement form at all - so there is nothing left to hide.
//
// UNCONFIRMED: the exact stored value shape for an ArtifactTypeSingleSelect
// setting (settings["type1"] etc.) hasn't been tested before. Assumed to
// be the Requirement Type's numeric ID, as a string, matching the pattern
// every other native setting has shown so far. A one-time console.log is
// left in on the first load to make this visible immediately - remove it
// once confirmed.
//
// Maximum number width is fixed at 4 digits (max 9999 per prefix) rather
// than admin-configurable, per direct instruction: a project with more
// than 9999 requirements of one prefix has bigger problems. Similarly, 20
// Type/Prefix pairs is a deliberate hard ceiling, not admin-configurable -
// a project with more than 20 Requirement types is out of scope.
//
// DESIGN NOTE: registerEvent_dataPreSave's handler runs synchronously with
// the save that is already underway - there is no guarantee an async call
// started inside it will finish before the save's field data is read. So
// counters are loaded once up front (on load / on artifact switch) into
// the module-level cache below, and the dataPreSave handler itself never
// awaits anything before calling updateFormField. Persisting the
// incremented counter back to Storage happens after that, fire-and-forget.
// The Type/Prefix pairs need no such care - they come from
// SpiraAppSettings, already available synchronously with no load step.
//
// KNOWN LIMITATION: counters are incremented client-side with no server-side
// locking. Two users saving a requirement of the same prefix at almost the
// same moment could theoretically read the same "current" counter value and
// each produce the same next number. This is a limitation of doing this
// entirely with documented SpiraApp client-side functionality (there is no
// documented atomic-increment storage primitive) and should be weighed
// against how busy a given project is. Flag this to Inmarsys before relying
// on it for a high-concurrency project.
// =============================================================================

(function () {
    "use strict";

    var APP_NAME = "CustomRequirementsNumbering";
    var PRC_PREFIX = "prc_";
    var MAX_COUNTER = 9999;
    var WIDTH = 4;
    var MAX_PAIRS = 20;

    var storageCache = {};        // raw key/value from storageGetProductAll (PRC counters only)
    var prefixByTypeId = {};      // parsed from the 20 Type/Prefix settings, keyed by TypeID string
    var countersLoaded = false;   // guards onDataPreSave against firing before Storage load finishes
    var loggedRawSettingsOnce = false;

    function nativeSettings() {
        return SpiraAppSettings[APP_GUID] || {};
    }

    // Native ArtifactCustomProperty settings store a raw PropertyNumber
    // (e.g. "3"), not a usable field name - confirmed by hitting this on
    // an earlier SpiraApp for this client. formatCustomFieldName converts
    // it to Custom_NN synchronously, no API call needed.
    function resolveFieldName(propertyNumberRaw) {
        if (!propertyNumberRaw) { return null; }
        return spiraAppManager.formatCustomFieldName(parseInt(propertyNumberRaw, 10));
    }

    function padNumber(n) {
        var s = String(n);
        while (s.length < WIDTH) { s = "0" + s; }
        return s;
    }

    // Recovers {prefix, number} from an existing RNF value using the fixed
    // 4-digit width.
    function parseRnf(value) {
        if (!value || value === "N/A") { return null; }
        if (value.length <= WIDTH) { return null; }
        var numPart = value.slice(value.length - WIDTH);
        var prefixPart = value.slice(0, value.length - WIDTH);
        if (!/^[0-9]+$/.test(numPart)) { return null; }
        return { prefix: prefixPart, number: parseInt(numPart, 10) };
    }

    function prefixForType(typeId) {
        var p = prefixByTypeId[String(typeId)];
        return p ? p : "N/A";
    }

    function getPrc(prefix) {
        var raw = storageCache[PRC_PREFIX + prefix];
        return raw ? parseInt(raw, 10) : 0;
    }

    // Fire-and-forget persistence of a new counter value (see design note above).
    function persistPrc(prefix, value) {
        var key = PRC_PREFIX + prefix;
        storageCache[key] = String(value);
        spiraAppManager.storageUpdateProduct(
            APP_GUID, APP_NAME, key, String(value), spiraAppManager.projectId,
            function () { /* stored */ },
            function () {
                // Key didn't exist yet - first ever use of this prefix
                spiraAppManager.storageInsertProduct(
                    APP_GUID, APP_NAME, key, String(value), spiraAppManager.projectId, false,
                    function () { /* stored */ },
                    function (err) { console.error("CustomRequirementsNumbering: could not persist PRC for '" + prefix + "'", err); }
                );
            }
        );
    }

    function normaliseStorageDump(items) {
        // storageGetProductAll's success callback returns a JSON STRING on
        // this instance, not an already-parsed object as the docs describe -
        // parse it defensively either way.
        if (typeof items === "string") {
            try { return JSON.parse(items) || {}; } catch (e) { return {}; }
        }
        return items || {};
    }

    function loadCounters(cb) {
        spiraAppManager.storageGetProductAll(
            APP_GUID, APP_NAME, spiraAppManager.projectId,
            function (items) { storageCache = normaliseStorageDump(items); cb(); },
            function () { storageCache = {}; cb(); }
        );
    }

    // Reads the 20 Type/Prefix setting pairs directly - no async, no
    // custom list, no wrapper field. On a duplicate TypeID across pairs,
    // the first one encountered (lowest pair number) wins - later ones
    // are silently ignored, not treated as an error, per direct
    // instruction.
    function loadPrefixesFromSettings(settings) {
        prefixByTypeId = {};

        if (!loggedRawSettingsOnce) {
            loggedRawSettingsOnce = true;
            console.log("CustomRequirementsNumbering: first pair's raw setting values - type1:", settings.type1, "prefix1:", settings.prefix1);
        }

        for (var i = 1; i <= MAX_PAIRS; i++) {
            var typeIdRaw = settings["type" + i];
            var prefixRaw = settings["prefix" + i];
            if (!typeIdRaw || !prefixRaw) { continue; }
            var typeId = String(typeIdRaw).trim();
            var prefix = String(prefixRaw).trim();
            if (!typeId || !prefix) { continue; }
            if (prefixByTypeId[typeId] !== undefined) { continue; } // first wins
            prefixByTypeId[typeId] = prefix;
        }
    }

    function loadEverything() {
        countersLoaded = false;
        var settings = nativeSettings();

        loadPrefixesFromSettings(settings);

        loadCounters(function () { countersLoaded = true; });
    }

    function applyNameSubstitution(rnfValue, nameSubstitution) {
        if (!nameSubstitution) { return; }               // unticked -> leave Name alone
        if (!rnfValue || rnfValue === "N/A") { return; }  // N/A -> leave Name alone
        spiraAppManager.updateFormField("Name", "textValue", rnfValue);
    }

    function onDataPreSave() {
        var settings = nativeSettings();
        // Boolean settings are documented (from an earlier SpiraApp for
        // this client) as storing "True"/"False", capitalised - not
        // lowercase "true". Comparing case-insensitively to be safe
        // either way, rather than assuming one casing.
        var nameSubstitution = settings.nameSubstitution === true ||
            String(settings.nameSubstitution).toLowerCase() === "true";

        if (!settings.rnfPropertyName || !countersLoaded) {
            // Not configured yet, or the async Storage load from this
            // page's own onLoad hasn't finished (shouldn't normally
            // happen - loaded fires well before a user could plausibly save).
            return;
        }

        var rnfPropertyName = resolveFieldName(settings.rnfPropertyName);

        var typeField = spiraAppManager.getLiveFormFieldValue("RequirementTypeId") || {};
        var currentTypeId = typeField.intValue;
        var newPrefix = prefixForType(currentTypeId);

        var rnfField = spiraAppManager.getLiveFormFieldValue(rnfPropertyName) || {};
        var existingRnf = rnfField.textValue;

        // This type has no matching Type/Prefix pair -> always N/A, never advances
        if (newPrefix === "N/A") {
            spiraAppManager.updateFormField(rnfPropertyName, "textValue", "N/A");
            // Never substitute the Name in this case, regardless of the tickbox
            return;
        }

        var existing = parseRnf(existingRnf);

        // Already numbered AND the effective prefix hasn't changed -> do not advance
        if (existing && existing.prefix === newPrefix) {
            applyNameSubstitution(existingRnf, nameSubstitution);
            return;
        }

        // Either a brand new number, or the requirement's type changed to
        // one with a different prefix - both draw the next number for newPrefix.
        var currentPrc = getPrc(newPrefix);

        if (currentPrc >= MAX_COUNTER) {
            spiraAppManager.updateFormField(rnfPropertyName, "textValue", "N/A");
            spiraAppManager.displayWarningMessage(
                "Prefix '" + newPrefix + "' has reached its maximum of " + MAX_COUNTER +
                ". This requirement has been saved with N/A in its number field. Contact your Spira admin."
            );
            return;
        }

        var nextNumber = currentPrc + 1;
        var newRnf = newPrefix + padNumber(nextNumber);
        spiraAppManager.updateFormField(rnfPropertyName, "textValue", newRnf);
        persistPrc(newPrefix, nextNumber);
        applyNameSubstitution(newRnf, nameSubstitution);
    }

    spiraAppManager.registerEvent_loaded(loadEverything);
    spiraAppManager.registerEvent_dataPreSave(onDataPreSave);

})();
