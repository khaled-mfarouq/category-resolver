import Fuse from "fuse.js";

export default async function handler(req, res) {
    return res.status(200).json({
        success: true,
        body: req.body,
        bodyType: typeof req.body,
        requestParameters: req.body?.requestParameters,
        categories: req.body?.requestParameters?.categories,
        categoriesType: typeof req.body?.requestParameters?.categories,
        isArray: Array.isArray(req.body?.requestParameters?.categories)
    });
}