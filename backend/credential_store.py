"""Local credential storage. Windows uses user-bound DPAPI; Unix uses mode 0600."""
import ctypes
import json
import os
import tempfile
from ctypes import wintypes
from pathlib import Path


class CredentialStorageError(RuntimeError):
    """Safe user-facing storage failure, without credential values."""


class Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]


def windows_protect(data: bytes, decrypt=False) -> bytes:
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    result = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        raise OSError('无法访问本机加密凭据，请用原 Windows 用户登录。')
    try:
        return ctypes.string_at(result.pbData, result.cbData)
    finally:
        kernel.LocalFree(result.pbData)


class CredentialStore:
    def __init__(self, directory=None):
        default = Path(os.getenv('LOCALAPPDATA', str(Path.home() / '.local' / 'share'))) / 'Zhixu' / 'chatgpt'
        self.directory = Path(directory or os.getenv('ZHIXU_AUTH_DIR') or default)
        self.path = self.directory / 'credentials.dat'

    def load(self):
        try:
            if not self.path.exists():
                return {'accounts': [], 'selected': None}
            payload = self.path.resolve(strict=True).read_bytes()
            if os.name == 'nt':
                payload = windows_protect(payload, decrypt=True)
            return json.loads(payload)
        except (OSError, ValueError) as error:
            raise CredentialStorageError('无法读取本机授权信息，请确认使用原 Windows 用户，且授权配置目录可以访问。') from error

    def save(self, data):
        temporary = None
        try:
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            # MSIX redirection / junctions can map a lexical C: path to D:.
            # Resolve after mkdir, then create AND replace on that physical path.
            directory = self.directory.resolve(strict=True)
            target = directory / self.path.name
            payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
            if os.name == 'nt':
                payload = windows_protect(payload)
            descriptor, temporary = tempfile.mkstemp(dir=directory, prefix='.credential-')
            if os.name != 'nt':
                os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, 'wb') as file:
                file.write(payload)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, target)
        except OSError as error:
            raise CredentialStorageError('无法保存本机授权信息，请检查授权配置目录的写入权限和磁盘空间，然后重试登录。') from error
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
