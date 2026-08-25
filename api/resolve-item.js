import Fuse from "fuse.js";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Only POST requests are allowed"
        });
    }

    try {
        // Handle bodies sent as strings
        const rawBody =
            typeof req.body === "string"
                ? JSON.parse(req.body)
                : req.body;

        // Zendesk Ultimate sometimes wraps everything in requestParameters
        const body = rawBody.requestParameters || rawBody;

        let {
            items_param,
            item_id_user_input,
            universal_restdata_data,
            restaurant_choice
        } = body;


        /* =========================================================
           RESTAURANT SELECTION
           ========================================================= */

        // If restaurant selection parameters are provided,
        // resolve the selected restaurant first.
        if (
            universal_restdata_data !== undefined &&
            restaurant_choice !== undefined &&
            restaurant_choice !== null &&
            String(restaurant_choice).trim() !== ""
        ) {

            /* Zendesk may send the array as a JSON string */
            if (typeof universal_restdata_data === "string") {
                try {
                    universal_restdata_data =
                        JSON.parse(universal_restdata_data);
                } catch (e) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Unable to parse universal_restdata_data JSON",
                        received: universal_restdata_data,
                        error: e.message
                    });
                }
            }

            if (!Array.isArray(universal_restdata_data)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "universal_restdata_data must be an array",
                    debug: {
                        value: universal_restdata_data,
                        type: typeof universal_restdata_data,
                        isArray: Array.isArray(universal_restdata_data)
                    }
                });
            }

            const choice = String(restaurant_choice).trim();

            /* =====================================================
               Restaurant selection by 1-based index
               ===================================================== */

            const restaurantIndex = Number(choice);

            if (
                !Number.isInteger(restaurantIndex) ||
                restaurantIndex < 1 ||
                restaurantIndex > universal_restdata_data.length
            ) {
                return res.status(200).json({
                    success: true,
                    status: "not_found",
                    message: "Invalid restaurant selection",
                    restaurant_choice: restaurant_choice
                });
            }

            const selectedRestaurant =
                universal_restdata_data[restaurantIndex - 1];

            /* =====================================================
               Return selected restaurant
               ===================================================== */

            return res.status(200).json({
                success: true,
                status: "matched",
                match_type: "restaurant_index",
                confidence: 1,

                restaurant_choice: restaurantIndex,

                restaurant: {
                    id: selectedRestaurant.id,
                    restaurant_name:
                        selectedRestaurant.restaurant_name,
                    restaurant_uuid:
                        selectedRestaurant.restaurant_uuid,
                    restaurant_id:
                        selectedRestaurant.restaurant_id,
                    is_closed:
                        selectedRestaurant.is_closed,
                    price:
                        selectedRestaurant.price,
                    discounted_price:
                        selectedRestaurant.discounted_price,
                    category_id:
                        selectedRestaurant.category_id,
                    dish_name:
                        selectedRestaurant.dish_name
                },

                // Also return the important values at the top level
                // so Zendesk can easily store them as session parameters.
                restaurant_id:
                    selectedRestaurant.restaurant_id,

                restaurant_uuid:
                    selectedRestaurant.restaurant_uuid,

                category_id:
                    selectedRestaurant.category_id,

                restaurant_name:
                    selectedRestaurant.restaurant_name,

                dish_name:
                    selectedRestaurant.dish_name,

                item_id:
                    selectedRestaurant.id
            });
        }


        /* =========================================================
           EXISTING ITEM RESOLVER
           ========================================================= */

        /* Zendesk sends arrays as JSON strings */
        if (typeof items_param === "string") {
            try {
                items_param = JSON.parse(items_param);
            } catch (e) {
                return res.status(400).json({
                    success: false,
                    message: "Unable to parse items_param JSON",
                    received: items_param,
                    error: e.message
                });
            }
        }

        if (!Array.isArray(items_param)) {
            return res.status(400).json({
                success: false,
                message: "items_param must be an array",
                debug: {
                    items_param,
                    itemsType: typeof items_param,
                    isArray: Array.isArray(items_param)
                }
            });
        }

        if (!item_id_user_input) {
            return res.status(400).json({
                success: false,
                message: "item_id_user_input is required"
            });
        }

        const search =
            String(item_id_user_input).trim().toLowerCase();


        /* ==========================
           Exit commands
           ========================== */

        const exitCommands = [
            "exit",
            "cancel",
            "quit",
            "stop",
            "back",
            "menu",
            "end",
            "done",
            "bye",
            "goodbye",
            "never mind",
            "nevermind",
            "forget it",
            "no thanks",
            "no thank you"
        ];

        if (exitCommands.includes(search)) {
            return res.status(200).json({
                success: true,
                status: "exit",
                message: "User requested to exit."
            });
        }


        /* ==========================
           Exact ID match
           ========================== */

        const idMatch = items_param.find(
            item =>
                String(item.id).toLowerCase() === search
        );

        if (idMatch) {
            return res.status(200).json({
                success: true,
                status: "matched",
                match_type: "id",
                confidence: 1,
                item_id: idMatch.id,
                item_name:
                    idMatch.display_name || idMatch.name
            });
        }


        /* ==========================
           Index match (1-based)
           ========================== */

        const index = Number(search);

        if (
            Number.isInteger(index) &&
            index >= 1 &&
            index <= items_param.length
        ) {
            const indexMatch = items_param[index - 1];

            return res.status(200).json({
                success: true,
                status: "matched",
                match_type: "index",
                confidence: 1,
                item_index: index,
                item_id: indexMatch.id,
                item_name:
                    indexMatch.display_name || indexMatch.name
            });
        }


        /* ==========================
           Exact name match
           ========================== */

        const exactMatch = items_param.find(
            item =>
                (item.display_name || item.name || "")
                    .toLowerCase()
                    .trim() === search
        );

        if (exactMatch) {
            return res.status(200).json({
                success: true,
                status: "matched",
                match_type: "exact",
                confidence: 1,
                item_id: exactMatch.id,
                item_name:
                    exactMatch.display_name || exactMatch.name
            });
        }


        /* ==========================
           Fuzzy matching
           ========================== */

        const fuse = new Fuse(items_param, {
            keys: ["display_name", "name"],
            threshold: 0.35,
            includeScore: true,
            ignoreLocation: true
        });

        const results = fuse.search(search);

        if (results.length > 0) {
            const best = results[0];

            return res.status(200).json({
                success: true,
                status: "matched",
                match_type: "fuzzy",
                confidence:
                    Number(
                        (1 - (best.score || 0)).toFixed(2)
                    ),
                item_id: best.item.id,
                item_name:
                    best.item.display_name ||
                    best.item.name
            });
        }


        /* ==========================
           No match
           ========================== */

        return res.status(200).json({
            success: true,
            status: "not_found",
            message: "Item not found"
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message,
            stack: err.stack
        });
    }
}