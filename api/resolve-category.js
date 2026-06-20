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

let { category_text_list_id, cat_id_user_input } = body;

/* Zendesk sends arrays as JSON strings */
if (typeof category_text_list_id === "string") {
    try {
        category_text_list_id = JSON.parse(category_text_list_id);
    } catch (e) {
        return res.status(400).json({
            success: false,
            message: "Unable to parse category_text_list_id JSON",
            received: category_text_list_id,
            error: e.message
        });
    }
}

if (!Array.isArray(category_text_list_id)) {
    return res.status(400).json({
        success: false,
        message: "category_text_list_id must be an array",
        debug: {
            category_text_list_id,
            categoriesType: typeof category_text_list_id,
            isArray: Array.isArray(category_text_list_id)
        }
    });
}

        if (!cat_id_user_input) {
            return res.status(400).json({
                success: false,
                message: "cat_id_user_input is required"
            });
        }

        const search = String(cat_id_user_input).trim().toLowerCase();

        /* Exact ID match */
        const idMatch = category_text_list_id.find(
            c => String(c.id).toLowerCase() === search
        );

        if (idMatch) {
            return res.status(200).json({
                success: true,
                match_type: "id",
                confidence: 1,
                category_id: idMatch.id,
                category_name: idMatch.display_name || idMatch.name
            });
        }

        /* Exact name match */
        const exactMatch = category_text_list_id.find(c =>
            (c.display_name || c.name || "")
                .toLowerCase()
                .trim() === search
        );

        if (exactMatch) {
            return res.status(200).json({
                success: true,
                match_type: "exact",
                confidence: 1,
                category_id: exactMatch.id,
                category_name: exactMatch.display_name || exactMatch.name
            });
        }

        /* Fuzzy matching */
        const fuse = new Fuse(category_text_list_id, {
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
                category_id: best.item.id,
                category_name: best.item.display_name || best.item.name
            });
        }

        return res.status(404).json({
            success: false,
            message: "Category not found"
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message,
            stack: err.stack
        });
    }
}