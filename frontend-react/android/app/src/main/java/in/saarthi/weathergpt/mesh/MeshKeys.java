package in.saarthi.weathergpt.mesh;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;

/**
 * This phone's mesh identity: an ECDSA P-256 key that never leaves the
 * AndroidKeyStore. The node id other phones see is derived from its public
 * half, so it survives app restarts and cannot be claimed by another phone.
 */
final class MeshKeys implements MeshProtocol.Signer {
    private static final String ALIAS = "saarthi-mesh-identity";
    private final KeyStore ks;
    private final byte[] publicDer;

    MeshKeys() throws Exception {
        ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyPairGenerator g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            g.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build());
            g.generateKeyPair();
        }
        publicDer = ks.getCertificate(ALIAS).getPublicKey().getEncoded();
    }

    @Override
    public byte[] publicKeyDer() {
        return publicDer;
    }

    @Override
    public byte[] sign(byte[] data) throws Exception {
        PrivateKey key = (PrivateKey) ks.getKey(ALIAS, null);
        Signature s = Signature.getInstance("SHA256withECDSA");
        s.initSign(key);
        s.update(data);
        return s.sign();
    }
}
