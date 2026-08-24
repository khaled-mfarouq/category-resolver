import Fuse from "fuse.js";

export default async function handler(req, res) {
    // Explicitly enforce application/json formatting for Zendesk compatibility
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Only POST requests are allowed"
        });
    }

    try {
        // Handle bodies sent as strings safely
        const rawBody =
            typeof req.body === "string"
                ? JSON.parse(req.body)
                : req.body;

        // Zendesk Ultimate wraps everything inside requestParameters wrapper
        const body = rawBody.requestParameters || rawBody;

        let {
            items_param,
            item_id_user_input,
            universal_restdata_data,
            restaurant_choice
        } = body;


        /* =========================================================
           RESTAURANT SELECTION LOGIC
           ========================================================= */

        if (
            restaurant_choice !== undefined &&
            restaurant_choice !== null &&
            String(restaurant_choice).trim() !== ""
        ) {

            // FALLBACK: If universal_restdata_data is absent but items_param is provided
            if (universal_restdata_data === undefined && items_param !== undefined) {
                universal_restdata_data = items_param;
            }

            /* Zendesk sends arrays serialized as JSON strings */
            if (typeof universal_restdata_data === "string") {
                try {
                    universal_restdata_data = JSON.parse(universal_restdata_data);
                } catch (e) {
                    return res.status(400).json({
                        success: false,
                        message: "Unable to parse universal_restdata_data JSON string",
                        received: universal_restdata_data,
                        error: e.message
                    });
                }
            }

            if (!Array.isArray(universal_restdata_data)) {
                return res.status(200).json({
                    success: true,
                    status: "not_found",
                    message: "Data catalog array is missing or invalid in payload mapping",
                    restaurant_choice: restaurant_choice
                });
            }

            const choice = String(restaurant_choice).trim();

            /* =====================================================
               Restaurant index processing (e.g. choice = "7")
               ===================================================== */
            const restaurantIndex = Number(choice);

            if (Number.isInteger(restaurantIndex)) {
                if (restaurantIndex >= 1 && restaurantIndex <= universal_restdata_data.length) {
                    const selectedRestaurant = universal_restdata_data[restaurantIndex - 1];

                    return res.status(200).json({
                        success: true,
                        status: "matched",
                        match_type: "restaurant_index",
                        confidence: 1,
                        restaurant_choice: restaurantIndex,
                        restaurant: {
                            id: selectedRestaurant.id,
                            restaurant_name: selectedRestaurant.restaurant_name,
                            restaurant_uuid: selectedRestaurant.restaurant_uuid,
                            restaurant_id: selectedRestaurant.restaurant_id,
                            is_closed: selectedRestaurant.is_closed,
                            price: selectedRestaurant.price,
                            discounted_price: selectedRestaurant.discounted_price,
                            category_id: selectedRestaurant.category_id,
                            dish_name: selectedRestaurant.dish_name
                        },
                        restaurant_id: selectedRestaurant.restaurant_id,
                        restaurant_uuid: selectedRestaurant.restaurant_uuid,
                        category_id: selectedRestaurant.category_id,
                        restaurant_name: selectedRestaurant.restaurant_name,
                        dish_name: selectedRestaurant.dish_name,
                        item_id: selectedRestaurant.id
                    });
                } else {
                    return res.status(200).json({
                        success: true,
                        status: "not_found",
                        message: "Invalid restaurant index selection boundary",
                        restaurant_choice: restaurant_choice
                    });
                }
            }

            /* =====================================================
               Fuzzy text fallback search (e.g. choice = "Chicken")
               ===================================================== */
            const restaurantFuse = new Fuse(universal_restdata_data, {
                keys: ["restaurant_name", "dish_name"],
                threshold: 0.35,
                includeScore: true,
                ignoreLocation: true
            });

            const restaurantResults = restaurantFuse.search(choice);

            // FIXED: Added [0] index accessor to prevent array runtime crashes
            if (restaurantResults.length > 0) {
                const bestMatch = restaurantResults[0]; 
                const bestRestaurant = bestMatch.item;
                const bestScore = bestMatch.score;

                return res.status(200).json({
                    success: true,
                    status: "matched",
                    match_type: "restaurant_fuzzy",
                    confidence: Number((1 - (bestScore || 0)).toFixed(2)),
                    restaurant_id: bestRestaurant.restaurant_id,
                    restaurant_name: bestRestaurant.restaurant_name,
                    restaurant_uuid: bestRestaurant.restaurant_uuid,
                    category_id: bestRestaurant.category_id,
                    dish_name: bestRestaurant.dish_name,
                    item_id: bestRestaurant.id,
                    restaurant: bestRestaurant
                });
            }

            return res.status(200).json({
                success: true,
                status: "not_found",
                message: "No matching restaurant index or text name found",
                restaurant_choice: restaurant_choice
            });
        }


        /* =========================================================
           EXISTING ITEM RESOLVER (Fallback Block)
           ========================================================= */

        if (typeof items_param === "string") {
            try {
                items_param = JSON.parse(items_param);
            } catch (e) {
                return res.status(400).json({
                    success: false,
                    message: "Unable to parse items_param JSON string",
                    received: items_param,
                    error: e.message
                });
            }
        }

        if (!Array.isArray(items_param)) {
            return res.status(400).json({
                success: false,
                message: "items_param must be a valid array wrapper",
                debug: { items_param, itemsType: typeof items_param }
            });
        }

        if (!item_id_user_input) {
            return res.status(400).json({
                success: false,
                message: "item_id_user_input property parameter is required"
            });
        }

        const search = String(item_id_user_input).trim().toLowerCase();

        const exitCommands = [
            "exit", "cancel", "quit", "stop", "back", "menu", "end", "done", "bye", "goodbye", "never mind", "nevermind", "forget it", "no thanks", "no thank you"
        ];

        if (exitCommands.includes(search)) {
            return res.status(200).json({
                success: true,
                status: "exit",
                message: "User requested session exit sequence."
            });
        }

        const idMatch = items_param.find(
            item => String(item.id).toLowerCase() === search
        );

        if (idMatch) {
            return res.status(200).json({
                success: true,
                status: "matched",
                match_type: "id",
                confidence: 1,
                item_id: idMatch.id,
                item_name: idMatch.display_name || idMatch.name
            });
        }

        const index = Number(search);

        if (Number.isInteger(index) && index >= 1 && index <= items_param.length) {
            const indexMatch = items_param[index - 1];

            return res.status(200).json({
                success: true,
                status: "matched",
                match_type: "index",
                confidence: 1,
                item_index: index,
                item_id: indexMatch.id,
                item_name: indexMatch.display_name || indexMatch.name
            });
        }

        const exactMatch = items_param.find(
            item => (item.display_name || item.name || "").toLowerCase().trim() === search
        );

        if (exactMatch) {
            return res.status(200).json({
                success: true,
                status: "matched",
                match_type: "exact",
                confidence: 1,
                item_id: exactMatch.id,
                item_name: exactMatch.display_name || exactMatch.name
            });
        }

        const fuse = new Fuse(items_param, {
            keys: ["display_name", "name"],
            threshold: 0.35,
            includeScore: true,
            ignoreLocation: true
        });

        const results = fuse.search(search);

        // FIXED: Added [0] index accessor to prevent array runtime crashes
