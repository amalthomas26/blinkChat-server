export const successResponse  = (data:any,meta:any ={})=>{
    return {
        success:true,
        data,
        meta
    }
}