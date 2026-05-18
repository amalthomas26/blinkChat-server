export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(statusCode: number, message: string) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = true;

   
    Object.setPrototypeOf(this, ApiError.prototype); //take this object and make sure it is officially part of the ApiError family


    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor); //dont include the constructor itself in the error history
    }
  }
}

//the history is called a stack trace //where the error came from
