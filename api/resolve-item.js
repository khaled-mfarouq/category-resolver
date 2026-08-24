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

        /* =========================================================
           RESTAURANT SELECTION LOGIC
           ========================================================= */
        if (
            restaurant_choice !== undefined &&
            restaurant_choice !== null &&
            String(restaurant_choice).trim() !== ""
        ) {

            if (universal_restdata_data === undefined && items_param !== undefined) {
                universal_restdata_data = items_param;
            }

            if (typeof universal_restdata_data === "string") {
                try {
                    universal_restdata_data = JSON.parse(universal_restdata_data);
                } catch (e) {
                    return res.status(200).json({
                        data: { status: "error", message: "JSON parse error" }
                    });
                }
            }

            if (!Array.isArray(universal_restdata_data)) {
                return res.status(200).json({
                    data: { status: "not_found", message: "Catalog is not an array" }
                });
            }

            const choice = String(restaurant_choice).trim();
            const restaurantIndex = Number(choice);

            if (Number.isInteger(restaurantIndex)) {
                if (restaurantIndex >= 1 && restaurantIndex <= universal_restdata_data.length) {
                    const selectedRestaurant = universal_restdata_data[restaurantIndex - 1];

                    // Matches your data.status mapping perfectly
                    return res.status(200).json({
                        data: {
                            status: "matched",
                            match_type: "restaurant_index",
                            restaurant_id: selectedRestaurant.restaurant_id,
                            restaurant_name: selectedRestaurant.restaurant_name,
                            dish_name: selectedRestaurant.dish_name,
                            item_id: selectedRestaurant.id
                        }
                    });
                } else {
                    return res.status(200).json({
                        data: { status: "not_found", message: "Index out of bounds" }
                    });
                }
            }

            // Fuzzy Text Search Fallback
            const restaurantFuse = new Fuse(universal_restdata_data, {
                keys: ["restaurant_name", "dish_name"],
                threshold: 0.35,
                includeScore: true,
                ignoreLocation: true
            });

            const restaurantResults = restaurantFuse.search(choice);

            if (restaurantResults.length > 0) {
                const bestMatch = restaurantResults[0]; 
                const bestRestaurant = bestMatch.item;

                return res.status(200).json({
                    data: {
                        status: "matched",
                        match_type: "restaurant_fuzzy",
                        restaurant_id: bestRestaurant.restaurant_id,
                        restaurant_name: bestRestaurant.restaurant_name,
                        dish_name: bestRestaurant.dish_name,
                        item_id: bestRestaurant.id
                    }
                });
            }

            return res.status(200).json({
                data: { status: "not_found", message: "No match found" }
            });
        }

        /* =========================================================
           EXISTING ITEM RESOLVER (Fallback Section)
           ========================================================= */
        if (typeof items_param === "string") {
            try { items_param = JSON.parse(items_param); } catch (e) {
                return res.status(200).json({ data: { status: "error" } });
            }
        }

        if (!Array.isArray(items_param) || !item_id_user_input) {
            return res.status(200).json({ data: { status: "not_found" } });
        }

        const search = String(item_id_user_input).trim().toLowerCase();

        const idMatch = items_param.find(item => String(item.id).toLowerCase() === search);
        if (idMatch) {
            return res.status(200).json({
                data: { status: "matched", match_type: "id", item_id: idMatch.id }
            });
        }

        const index = Number(search);
        if (Number.isInteger(index) && index >= 1 && index <= items_param.length) {
            const indexMatch = items_param[index - 1];
            return res.status(200).json({
                data: { status: "matched", match_type: "index", item_id: indexMatch.id }
            });
        }

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
                data: { status: "matched", match_type: "fuzzy", item_id: best.item.id }
            });
        }

        return res.status(200).json({
            data: { status: "not_found" }
        });

    } catch (err) {
        // Safe Catch-All: Always returns data.status so Zendesk never hits the 500 error path
        return res.status(200).json({
            data: {
                status: "error",
                message: err.message
            }
        });
    }
}
