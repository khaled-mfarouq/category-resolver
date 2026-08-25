import Fuse from "fuse.js";

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Only POST requests are allowed"
        });
    }

    try {
        const rawBody = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        const body = rawBody.requestParameters || rawBody;

        let {
            items_param,
            item_id_user_input,
            universal_restdata_data,
            restaurant_choice
        } = body;

        // Clean user input text
        const searchInput = String(item_id_user_input || restaurant_choice || "").trim();
        const searchLower = searchInput.toLowerCase();

        /* =========================================================
           1. GLOBAL EXIT COMMAND CHECK (FIRST PRIORITY)
           ========================================================= */
        const exitCommands = [
            "exit", "cancel", "quit", "stop", "back", "menu", "end", "done", 
            "bye", "goodbye", "never mind", "nevermind", "forget it", "no thanks", "no thank you"
        ];

        if (exitCommands.includes(searchLower)) {
            const exitPayload = {
                success: true,
                status: "exit",
                match_type: "exit",
                confidence: 1,
                message: "User requested exit sequence."
            };
            return res.status(200).json({ ...exitPayload, data: exitPayload });
        }

        /* =========================================================
           2. NUMERIC INDEX LOOKUP SELECTION
           ========================================================= */
        const numericIndex = Number(searchInput);

        if (Number.isInteger(numericIndex)) {
            // Pick the correct active array data layer dynamically
            const activeCatalog = universal_restdata_data || items_param;
            let catalogArray = [];

            if (typeof activeCatalog === "string") {
                try { catalogArray = JSON.parse(activeCatalog); } catch(e) {}
            } else if (Array.isArray(activeCatalog)) {
                catalogArray = activeCatalog;
            }

            if (catalogArray.length > 0 && numericIndex >= 1 && numericIndex <= catalogArray.length) {
                const itemMatch = catalogArray[numericIndex - 1];
                const indexPayload = {
                    success: true,
                    status: "matched",
                    match_type: "index",
                    confidence: 1,
                    restaurant_id: itemMatch.restaurant_id || null,
                    restaurant_name: itemMatch.restaurant_name || null,
                    dish_name: itemMatch.dish_name || itemMatch.name || null,
                    item_id: itemMatch.id || itemMatch.restaurant_id || null,
                    item_name: itemMatch.display_name || itemMatch.name || itemMatch.restaurant_name || null
                };
                return res.status(200).json({ ...indexPayload, data: indexPayload });
            } else {
                const outOfBoundsPayload = {
                    success: true,
                    status: "not_found",
                    match_type: "none",
                    confidence: 0,
                    message: "Selection index out of catalog boundaries."
                };
                return res.status(200).json({ ...outOfBoundsPayload, data: outOfBoundsPayload });
            }
        }

        /* =========================================================
           3. FUZZY TEXT CATALOG LOOKUP
           ========================================================= */
        const targetCatalog = universal_restdata_data || items_param;
        let textCatalogArray = [];

        if (typeof targetCatalog === "string") {
            try { textCatalogArray = JSON.parse(targetCatalog); } catch(e) {}
        } else if (Array.isArray(targetCatalog)) {
            textCatalogArray = targetCatalog;
        }

        if (Array.isArray(textCatalogArray) && textCatalogArray.length > 0) {
            const fuse = new Fuse(textCatalogArray, {
                keys: ["restaurant_name", "dish_name", "display_name", "name"],
                threshold: 0.35,
                includeScore: true,
                ignoreLocation: true
            });

            const results = fuse.search(searchInput);

            if (results.length > 0 && results[0].score <= 0.35) {
                const best = results[0];
                const matchedPayload = {
                    success: true,
                    status: "matched",
                    match_type: "fuzzy",
                    confidence: Number((1 - best.score).toFixed(2)),
                    restaurant_id: best.item.restaurant_id || null,
                    restaurant_name: best.item.restaurant_name || null,
                    dish_name: best.item.dish_name || best.item.name || null,
                    item_id: best.item.id || null,
                    item_name: best.item.display_name || best.item.name || null
                };
                return res.status(200).json({ ...matchedPayload, data: matchedPayload });
            }
        }

        /* =========================================================
           4. GLOBAL NOT FOUND FALLBACK (Gibberish handling like "kkkkkk")
           ========================================================= */
        const fallbackPayload = {
            success: true,
            status: "not_found",
            match_type: "none",
            confidence: 0,
            message: "No entries match user search parameter values."
        };
        return res.status(200).json({ ...fallbackPayload, data: fallbackPayload });

    } catch (err) {
        const errorPayload = { status: "error", message: err.message };
        return res.status(200).json({ ...errorPayload, data: errorPayload });
    }
}
