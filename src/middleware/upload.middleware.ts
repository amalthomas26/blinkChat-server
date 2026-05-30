import {Request} from "express";
import multer ,{FileFilterCallback} from "multer";

import {runtimeConfig as config} from "../config/env";
import {ApiError} from  "../utils/ApiError"

const MAX_SIZE_BYTES = config.upload.maxSizeMb * 1024 * 1024; //computer works in bytes


const fileFilter =(
    req:Request,
    file:Express.Multer.File,
    cb:FileFilterCallback
) =>{
    if(config.upload.allowedMimeTypes.includes(file.mimetype)){
        cb(null,true);
    } else {
        cb(new ApiError(400,`File type "${file.mimetype}" is not allowed`) as unknown as Error)
    }
};

export const uploadMiddleware = multer({
    limits:{
        fileSize:MAX_SIZE_BYTES,
        files:1, //Only one file per request
    },
    fileFilter
}); //read incoming file streams ,parsing form-data,attaching file to req.file


// Client → HTTP request (multipart/form-data)
//         ↓
// uploadMiddleware (Multer)
//         ↓
// fileFilter + limits check
//         ↓
// controller (your logic)




