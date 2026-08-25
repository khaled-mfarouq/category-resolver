export default async function handler(req, res) {
    console.log("========== API CALLED ==========");
    console.log("METHOD:", req.method);
    console.log("BODY:", req.body);
    console.log("================================");

    return res.status(200).json({
        success: true,
        status: "test",
        message: "API is working",
        received: req.body
    });
}