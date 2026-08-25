import Fuse from "fuse.js";

export default async function handler(req, res) {

    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Only POST requests are allowed"
        });
    }

    try {

        /* =========================================================
           READ REQUEST
           ========================================================= */

        const rawBody =
            typeof req.body === "string"
                ? JSON.parse(req.body)
                : req.body;

        const body =
            rawBody?.requestParameters || rawBody || {};

        let {
            items_param,
            item_id_user_input,
            universal_restdata_data,
            restaurant_choice
        } = body;


        /* =========================================================
           DEBUG
           ========================================================= */

        console.log("====================================");
        console.log("RESOLVER REQUEST");
        console.log("restaurant_choice:", restaurant_choice);
        console.log("item_id_user_input:", item_id_user_input);
        console.log(
            "items_param type:",
            typeof items_param
        );
        console.log(
            "universal_restdata_data type:",
            typeof universal_restdata_data
        );
        console.log("====================================");


        /* =========================================================
           RESTAURANT SELECTION
           
           IMPORTANT:
           restaurant_choice is ONLY used for restaurant selection.
           ========================================================= */

        if (
            restaurant_choice !== undefined &&
            restaurant_choice !== null &&
            String(restaurant_choice).trim() !== ""
        ) {

            /* -----------------------------------------------
               Parse restaurant data if Zendesk sends JSON string
               ----------------------------------------------- */

            if (typeof universal_restdata_data === "string") {

                try {

                    universal_restdata_data =
                        JSON.parse(universal_restdata_data);

                } catch (e) {

                    return res.status(400).json({
                        success: false,
                        status: "error",
                        message:
                            "Unable to parse universal_restdata_data JSON",
                        error: e.message
                    });
                }
            }


            /* -----------------------------------------------
               Validate restaurant array
               ----------------------------------------------- */

            if (!Array.isArray(universal_restdata_data)) {

                return res.status(400).json({
                    success: false,
                    status: "error",
                    message:
                        "universal_restdata_data must be an array",
                    debug: {
                        value: universal_restdata_data,
                        type: typeof universal_restdata_data,
                        isArray:
                            Array.isArray(
                                universal_restdata_data
                            )
                    }
                });
            }


            const choice =
                String(restaurant_choice)
                    .trim()
                    .toLowerCase();


            /* -----------------------------------------------
               Handle accidental exit input
               
               This is optional, but prevents the API from
               treating "exit" as a restaurant selection.
               ----------------------------------------------- */

            const restaurantExitCommands = [
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

            if (
                restaurantExitCommands.includes(choice)
            ) {

                return res.status(200).json({
                    success: true,
                    status: "exit",
                    match_type: "exit",
                    confidence: 1,
                    restaurant_choice:
                        restaurant_choice,
                    message:
                        "User requested to exit."
                });
            }


            /* -----------------------------------------------
               Restaurant selection must be numeric
               ----------------------------------------------- */

            const restaurantIndex =
                Number(choice);


            if (
                !Number.isInteger(restaurantIndex) ||
                restaurantIndex < 1 ||
                restaurantIndex >
                    universal_restdata_data.length
            ) {

                return res.status(200).json({
                    success: true,
                    status: "not_found",
                    match_type:
                        "restaurant_not_found",
                    confidence: 0,
                    restaurant_choice:
                        restaurant_choice,
                    message:
                        "Invalid restaurant selection."
                });
            }


            /* -----------------------------------------------
               Get selected restaurant
               ----------------------------------------------- */

            const selectedRestaurant =
                universal_restdata_data[
                    restaurantIndex - 1
                ];


            if (!selectedRestaurant) {

                return res.status(200).json({
                    success: true,
                    status: "not_found",
                    match_type:
                        "restaurant_not_found",
                    confidence: 0,
                    restaurant_choice:
                        restaurant_choice,
                    message:
                        "Restaurant not found."
                });
            }


            /* -----------------------------------------------
               Return selected restaurant
               ----------------------------------------------- */

            return res.status(200).json({

                success: true,

                status: "matched",

                match_type:
                    "restaurant_index",

                confidence: 1,

                restaurant_choice:
                    restaurantIndex,

                restaurant: {

                    id:
                        selectedRestaurant.id,

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
           ITEM RESOLVER
           ========================================================= */

        /* -----------------------------------------------
           Parse items_param
           ----------------------------------------------- */

        if (typeof items_param === "string") {

            try {

                items_param =
                    JSON.parse(items_param);

            } catch (e) {

                return res.status(400).json({
                    success: false,
                    status: "error",
                    message:
                        "Unable to parse items_param JSON",
                    error: e.message
                });
            }
        }


        /* -----------------------------------------------
           Validate items array
           ----------------------------------------------- */

        if (!Array.isArray(items_param)) {

            return res.status(400).json({
                success: false,
                status: "error",
                message:
                    "items_param must be an array",
                debug: {
                    items_param,
                    itemsType:
                        typeof items_param,
                    isArray:
                        Array.isArray(items_param)
                }
            });
        }


        /* -----------------------------------------------
           Validate user input
           ----------------------------------------------- */

        if (
            item_id_user_input === undefined ||
            item_id_user_input === null ||
            String(item_id_user_input).trim() === ""
        ) {

            return res.status(400).json({
                success: false,
                status: "error",
                message:
                    "item_id_user_input is required"
            });
        }


        const search =
            String(item_id_user_input)
                .trim()
                .toLowerCase();


        console.log(
            "ITEM SEARCH INPUT:",
            search
        );


        /* =========================================================
           EXIT COMMANDS
           ========================================================= */

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

            console.log(
                "EXIT COMMAND DETECTED:",
                search
            );

            return res.status(200).json({

                success: true,

                status: "exit",

                match_type: "exit",

                confidence: 1,

                item_id: null,

                item_name: null,

                message:
                    "User requested to exit."
            });
        }


        /* =========================================================
           EXACT ID MATCH
           ========================================================= */

        const idMatch =
            items_param.find(
                item =>
                    String(item.id)
                        .toLowerCase() === search
            );


        if (idMatch) {

            return res.status(200).json({

                success: true,

                status: "matched",

                match_type: "id",

                confidence: 1,

                item_id:
                    idMatch.id,

                item_name:
                    idMatch.display_name ||
                    idMatch.name
            });
        }


        /* =========================================================
           INDEX MATCH - 1 BASED
           ========================================================= */

        const index =
            Number(search);


        if (
            Number.isInteger(index) &&
            index >= 1 &&
            index <= items_param.length
        ) {

            const indexMatch =
                items_param[index - 1];


            return res.status(200).json({

                success: true,

                status: "matched",

                match_type: "index",

                confidence: 1,

                item_index:
                    index,

                item_id:
                    indexMatch.id,

                item_name:
                    indexMatch.display_name ||
                    indexMatch.name
            });
        }


        /* =========================================================
           EXACT NAME MATCH
           ========================================================= */

        const exactMatch =
            items_param.find(
                item =>
                    (
                        item.display_name ||
                        item.name ||
                        ""
                    )
                    .toLowerCase()
                    .trim() === search
            );


        if (exactMatch) {

            return res.status(200).json({

                success: true,

                status: "matched",

                match_type: "exact",

                confidence: 1,

                item_id:
                    exactMatch.id,

                item_name:
                    exactMatch.display_name ||
                    exactMatch.name
            });
        }


        /* =========================================================
           FUZZY MATCHING
           ========================================================= */

        const FUZZY_THRESHOLD =
            0.35;


        const fuse =
            new Fuse(items_param, {

                keys: [
                    "display_name",
                    "name"
                ],

                threshold:
                    FUZZY_THRESHOLD,

                includeScore:
                    true,

                ignoreLocation:
                    true
            });


        const results =
            fuse.search(search);


        console.log(
            "FUZZY RESULTS:",
            results.map(
                result => ({
                    name:
                        result.item.display_name ||
                        result.item.name,

                    id:
                        result.item.id,

                    score:
                        result.score
                })
            )
        );


        if (results.length > 0) {

            const best =
                results[0];


            const score =
                typeof best.score === "number"
                    ? best.score
                    : 1;


            console.log(
                "BEST FUZZY MATCH:",
                {
                    input: search,
                    name:
                        best.item.display_name ||
                        best.item.name,
                    id:
                        best.item.id,
                    score,
                    threshold:
                        FUZZY_THRESHOLD
                }
            );


            if (
                score <=
                FUZZY_THRESHOLD
            ) {

                return res.status(200).json({

                    success: true,

                    status: "matched",

                    match_type: "fuzzy",

                    confidence:
                        Number(
                            (
                                1 - score
                            ).toFixed(2)
                        ),

                    item_id:
                        best.item.id,

                    item_name:
                        best.item.display_name ||
                        best.item.name
                });
            }
        }


        /* =========================================================
           NO MATCH
           ========================================================= */

        console.log(
            "NO ITEM MATCH:",
            search
        );


        return res.status(200).json({

            success: true,

            status: "not_found",

            match_type: "none",

            confidence: 0,

            item_id: null,

            item_name: null,

            message:
                "Item not found"
        });


    } catch (err) {

        console.error(
            "RESOLVER ERROR:",
            err
        );

        return res.status(500).json({

            success: false,

            status: "error",

            message:
                err.message,

            stack:
                err.stack
        });
    }
}