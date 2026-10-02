import type { UserResponse } from './dto/user-response.dto';
import type { User } from './users.types';

export function toUserResponse(user: User): UserResponse {
  return {
    createdAt: user.createdAt,
    email: user.email,
    id: user.id,
    status: user.status,
  };
}
