<?php

namespace App\Service;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Security\Core\Exception\AuthenticationException;

class AuthService
{
    private EntityManagerInterface $entityManager;
    private UserPasswordHasherInterface $passwordHasher;

    public function __construct(
        EntityManagerInterface $entityManager,
        UserPasswordHasherInterface $passwordHasher
    ) {
        $this->entityManager = $entityManager;
        $this->passwordHasher = $passwordHasher;
    }

    /**
     * Authentifie un utilisateur avec son email et mot de passe
     * 
     * @param string $email Email de l'utilisateur
     * @param string $password Mot de passe de l'utilisateur
     * @param bool $checkVerification Si true, vérifie que l'email est validé
     * @return User L'utilisateur authentifié
     * @throws AuthenticationException Si l'authentification échoue
     */
    public function authenticateUser(string $email, string $password, bool $checkVerification = true): User
    {
        $user = $this->entityManager->getRepository(User::class)->findOneBy(['email' => $email]);

        if (!$user) {
            throw new AuthenticationException('Email ou mot de passe incorrect.');
        }

        if (!$this->passwordHasher->isPasswordValid($user, $password)) {
            throw new AuthenticationException('Email ou mot de passe incorrect.');
        }
        
        // Temporairement désactivé : Vérification de l'email
        /*if ($checkVerification && !$user->isEmailVerified()) {
            throw new AuthenticationException('Veuillez vérifier votre adresse email avant de vous connecter.');
        }*/

        return $user;
    }

    /**
     * Vérifie si un utilisateur est vérifié
     * 
     * @param User $user L'utilisateur à vérifier
     * @return bool True si l'utilisateur est vérifié
     */
    public function isUserVerified(User $user): bool
    {
        return $user->isEmailVerified();
    }

    /**
     * Récupère les informations de base d'un utilisateur
     * 
     * @param User $user L'utilisateur
     * @return array Les informations de base de l'utilisateur
     */
    public function getUserInfo(User $user): array
    {
        return [
            'id' => $user->getId(),
            'firstName' => $user->getFirstName(),
            'lastName' => $user->getLastName(),
            'email' => $user->getEmail(),
            'roles' => $user->getRoles(),
            'isEmailVerified' => $user->isEmailVerified(),
        ];
    }
} 