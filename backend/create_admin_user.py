import argparse
import getpass
import hashlib
import secrets
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

from main import DATABASE_URL


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        260_000,
    ).hex()


def parse_args():
    parser = argparse.ArgumentParser(description="Create or update an admin user.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--first-name", default="Admin")
    parser.add_argument("--middle-name", default=None)
    parser.add_argument("--last-name", default="User")
    parser.add_argument("--role", default="admin")
    parser.add_argument("--update", action="store_true")
    return parser.parse_args()


def main():
    load_dotenv(Path(__file__).with_name(".env"))
    args = parse_args()
    password = getpass.getpass("Admin password: ")
    confirm_password = getpass.getpass("Confirm password: ")

    if password != confirm_password:
        raise SystemExit("Passwords do not match.")

    if not password:
        raise SystemExit("Password cannot be empty.")

    salt = secrets.token_hex(16)
    password_hash = hash_password(password, salt)
    engine = create_engine(DATABASE_URL)

    conflict_action = (
        """
        DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            salt = EXCLUDED.salt,
            first_name = EXCLUDED.first_name,
            middle_name = EXCLUDED.middle_name,
            last_name = EXCLUDED.last_name,
            role = EXCLUDED.role,
            updated_at = NOW()
        """
        if args.update
        else "DO NOTHING"
    )

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    first_name TEXT NOT NULL,
                    middle_name TEXT NULL,
                    last_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'admin',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
        )
        result = conn.execute(
            text(
                f"""
                INSERT INTO users (
                    email,
                    password_hash,
                    salt,
                    first_name,
                    middle_name,
                    last_name,
                    role
                )
                VALUES (
                    :email,
                    :password_hash,
                    :salt,
                    :first_name,
                    :middle_name,
                    :last_name,
                    :role
                )
                ON CONFLICT (email) {conflict_action}
                RETURNING id;
                """
            ),
            {
                "email": args.email.strip().lower(),
                "password_hash": password_hash,
                "salt": salt,
                "first_name": args.first_name,
                "middle_name": args.middle_name,
                "last_name": args.last_name,
                "role": args.role,
            },
        ).first()

    action = "created or updated" if args.update else "created"
    if result is None and not args.update:
        print("User already exists. Re-run with --update to replace the password/details.")
        return

    print(f"Admin user {action}: {args.email.strip().lower()}")


if __name__ == "__main__":
    main()
