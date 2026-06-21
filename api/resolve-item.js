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

let { items_param, item_id_user_input } = body;

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
            categoriesType: typeof items_param,
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

        const search = String(item_id_user_input).trim().toLowerCase();

        /* Exact ID match */
        const idMatch = items_param.find(
            c => String(c.id).toLowerCase() === search
        );

        if (idMatch) {
            return res.status(200).json({
                success: true,
                match_type: "id",
                confidence: 1,
                item_id: idMatch.id,
                item_name: idMatch.display_name || idMatch.name
            });
        }

        /* Exact name match */
        const exactMatch = items_param.find(c =>
            (c.display_name || c.name || "")
                .toLowerCase()
                .trim() === search
        );

        if (exactMatch) {
            return res.status(200).json({
                success: true,
                match_type: "exact",
                confidence: 1,
                item_id: exactMatch.id,
                item_name: exactMatch.display_name || exactMatch.name
            });
        }

        /* Fuzzy matching */
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
                match_type: "fuzzy",
                confidence: Number((1 - (best.score || 0)).toFixed(2)),
                item_id: best.item.id,
                item_name: best.item.display_name || best.item.name
            });
        }

        return res.status(404).json({
            success: false,
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