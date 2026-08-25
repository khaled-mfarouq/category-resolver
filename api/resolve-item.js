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

        // Unified clean input tracking
        const rawUserInput = String(item_id_user_input || restaurant_choice || "").trim().toLowerCase();

        /* =========================================================
           1. GLOBAL EXIT COMMAND CHECK
           ========================================================= */
        const exitCommands = [
            "exit", "cancel", "quit", "stop", "back", "menu", "end", "done", 
            "bye", "goodbye", "never mind", "nevermind", "forget it", "no thanks", "no thank you"
        ];

        if (exitCommands.includes(rawUserInput)) {
            const exitPayload = {
                success: true,
                status: "exit",
                match_type: "exit",
                confidence: 1,
                message: "User requested exit."
            };
            // Send both formats for absolute safety with Zendesk custom mappings
            return res.status(200).json({
                ...exitPayload,
                data: exitPayload
            });
        }

        /* =========================================================
           2. RESTAURANT SELECTION PROCESS
           ========================================================= */
        if (
            universal_restdata_data !== undefined &&
            restaurant_choice !== undefined &&
            restaurant_choice !== null &&
            String(restaurant_choice).trim() !== ""
        ) {
            if (typeof universal_restdata_data === "string") {
                try {
                    universal_restdata_data = JSON.parse(universal_restdata_data);
                } catch (e) {
                    return res.status(200).json({ status: "error", data: { status: "error" } });
                }
            }

            if (!Array.isArray(universal_restdata_data)) {
                return res.status(200).json({ status: "error", data: { status: "error" } });
            }

            const choice = String(restaurant_choice).trim();
            const restaurantIndex = Number(choice);

            if (Number.isInteger(restaurantIndex) && restaurantIndex >= 1 && restaurantIndex <= universal_restdata_data.length) {
                const selectedRestaurant = universal_restdata_data[restaurantIndex - 1];
                const matchedPayload = {
                    success: true,
                    status: "matched",
                    match_type: "restaurant_index",
                    confidence: 1,
                    restaurant_id: selectedRestaurant.restaurant_id,
                    restaurant_name: selectedRestaurant.restaurant_name,
                    dish_name: selectedRestaurant.dish_name,
                    item_id: selectedRestaurant.id
                };
                return res.status(200).json({ ...matchedPayload, data: matchedPayload });
            }

            // Restaurant Name Fuzzy Fallback Check
            const restaurantFuse = new Fuse(universal_restdata_data, {
                keys: ["restaurant_name", "dish_name"],
                threshold: 0.35,
                includeScore: true,
                ignoreLocation: true
            });

            const restaurantResults = restaurantFuse.search(choice);

            if (restaurantResults.length > 0 && restaurantResults[0].score <= 0.35) {
                const bestRestaurant = restaurantResults[0].item;
                const matchedPayload = {
                    success: true,
                    status: "matched",
                    match_type: "restaurant_fuzzy",
                    confidence: Number((1 - restaurantResults[0].score).toFixed(2)),
                    restaurant_id: bestRestaurant.restaurant_id,
                    restaurant_name: bestRestaurant.restaurant_name,
                    dish_name: bestRestaurant.dish_name,
                    item_id: bestRestaurant.id
                };
                return res.status(200).json({ ...matchedPayload, data: matchedPayload });
            }

            const customNotFound = {
                success: true,
                status: "not_found",
                match_type: "none",
                confidence: 0,
                message: "No matching restaurant found"
            };
            return res.status(200).json({ ...customNotFound, data: customNotFound });
        }

        /* =========================================================
           3. STANDARD ITEM RESOLVER PROCESS
           ========================================================= */
        if (typeof items_param === "string") {
            try { items_param = JSON.parse(items_param); } catch (e) {
                return res.status(200).json({ status: "error", data: { status: "error" } });
            }
        }

        if (!Array.isArray(items_param) || !item_id_user_input || String(item_id_user_input).trim() === "") {
            const missingPayload = { status: "not_found", message: "Missing item data requirements" };
            return res.status(200).json({ ...missingPayload, data: missingPayload });
        }

        const search = String(item_id_user_input).trim().toLowerCase();

        const idMatch = items_param.find(item => String(item.id).toLowerCase() === search);
        if (idMatch) {
            const matchedPayload = { success: true, status: "matched", match_type: "id", item_id: idMatch.id, item_name: idMatch.display_name || idMatch.name };
            return res.status(200).json({ ...matchedPayload, data: matchedPayload });
        }

        const index = Number(search);
        if (Number.isInteger(index) && index >= 1 && index <= items_param.length) {
            const indexMatch = items_param[index - 1];
            const matchedPayload = { success: true, status: "matched", match_type: "index", item_id: indexMatch.id, item_name: indexMatch.display_name || indexMatch.name };
            return res.status(200).json({ ...matchedPayload, data: matchedPayload });
        }

        const fuse = new Fuse(items_param, {
            keys: ["display_name", "name"],
            threshold: 0.35,
            includeScore: true,
            ignoreLocation: true
        });

        const results = fuse.search(search);
        if (results.length > 0 && results[0].score <= 0.35) {
            const best = results[0];
            const matchedPayload = {
                success: true,
                status: "matched",
                match_type: "fuzzy",
                confidence: Number((1 - best.score).toFixed(2)),
                item_id: best.item.id,
                item_name: best.item.display_name || best.item.name
            };
            return res.status(200).json({ ...matchedPayload, data: matchedPayload });
        }

        const fallbackNotFound = {
            success: true,
            status: "not_found",
            match_type: "none",
            confidence: 0,
            message: "Item entity not found"
        };
        return res.status(200).json({ ...fallbackNotFound, data: fallbackNotFound });

    } catch (err) {
        const errorPayload = { status: "error", message: err.message };
        return res.status(200).json({ ...errorPayload, data: errorPayload });
    }
}
